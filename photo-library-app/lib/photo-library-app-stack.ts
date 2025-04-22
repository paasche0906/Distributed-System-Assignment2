import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns_subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from '../env';

export class PhotoLibraryAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket
    const imageBucket = new s3.Bucket(this, 'ImageBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // SNS Topic
    const snsTopic = new sns.Topic(this, 'ImageTopic', {
      displayName: 'Image Upload and Metadata Topic'
    });

    // S3 triggers SNS on image upload
    imageBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.SnsDestination(snsTopic)
    );

    // DynamoDB Table
    const imageTable = new dynamodb.Table(this, 'ImageTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
    });

    // Dead-Letter Queue
    const deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue');

    // Main SQS Queue
    const mainQueue = new sqs.Queue(this, 'MainQueue', {
      deadLetterQueue: {
        maxReceiveCount: 1,
        queue: deadLetterQueue,
      }
    });

    // Utility to create basic lambda config
    const createLambda = (id: string, handlerFile: string, env: Record<string, string>) =>
      new lambda.Function(this, id, {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: `${handlerFile}.handler`,
        code: lambda.Code.fromAsset('lambda'),
        environment: env,
      });

    // Lambda: Log Image
    const logImageLambda = createLambda('LogImageLambda', 'log-image', {
      TABLE_NAME: imageTable.tableName,
    });

    logImageLambda.addEventSourceMapping('LogImageEventSource', {
      eventSourceArn: mainQueue.queueArn,
      batchSize: 1,
    });

    imageTable.grantWriteData(logImageLambda);
    mainQueue.grantConsumeMessages(logImageLambda);

    snsTopic.addSubscription(new sns_subs.SqsSubscription(mainQueue));

    // Lambda: Remove Invalid Image
    const removeImageLambda = createLambda('RemoveImageLambda', 'remove-image', {
      BUCKET_NAME: imageBucket.bucketName,
    });

    removeImageLambda.addEventSource(new lambda_event_sources.SqsEventSource(deadLetterQueue));
    imageBucket.grantDelete(removeImageLambda);

    // Lambda: Add Metadata
    const addMetadataLambda = createLambda('AddMetadataLambda', 'add-metadata', {
      TABLE_NAME: imageTable.tableName,
    });

    imageTable.grantWriteData(addMetadataLambda);

    snsTopic.addSubscription(new sns_subs.LambdaSubscription(addMetadataLambda, {
      filterPolicy: {
        metadata_type: sns.SubscriptionFilter.stringFilter({
          allowlist: ['Caption', 'Date', 'Name'],
        }),
      }
    }));

    // Lambda: Update Status
    const updateStatusLambda = createLambda('UpdateStatusLambda', 'update-status', {
      TABLE_NAME: imageTable.tableName,
    });

    imageTable.grantWriteData(updateStatusLambda);

    snsTopic.addSubscription(new sns_subs.LambdaSubscription(updateStatusLambda, {
      filterPolicy: {
        metadata_type: sns.SubscriptionFilter.stringFilter({
          denylist: ['Caption', 'Date', 'Name'],
        }),
      }
    }));

    // Lambda: Send SES Email
    const statusUpdateMailerLambda = createLambda('StatusUpdateMailerLambda', 'status-update-mailer', {
      FROM_EMAIL: SES_EMAIL_FROM,
      TO_EMAIL: SES_EMAIL_TO,
      SES_REGION: SES_REGION,
      TABLE_NAME: imageTable.tableName,
    });

    statusUpdateMailerLambda.addEventSource(new lambda_event_sources.DynamoEventSource(imageTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 5,
    }));

    statusUpdateMailerLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));
  }
}
