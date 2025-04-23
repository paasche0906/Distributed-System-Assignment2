import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as events from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { SubscriptionFilter } from 'aws-cdk-lib/aws-sns';
import { SES_EMAIL_FROM, SES_EMAIL_TO } from '../env';

export class PhotoLibraryAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket for photo uploads
    const photoBucket = new s3.Bucket(this, 'PhotoGalleryBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // DynamoDB Table for photo info
    const photoTable = new dynamodb.Table(this, 'PhotoGalleryTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // SQS Queues (Log Queue + DLQ)
    const dlq = new sqs.Queue(this, 'ImageDLQ');
    const logQueue = new sqs.Queue(this, 'ImageLogQueue', {
      deadLetterQueue: {
        maxReceiveCount: 1,
        queue: dlq,
      },
    });

    // Lambda Creation Helper
    const createNodeFunction = (
      id: string,
      entryFile: string,
      environment: Record<string, string>,
      memorySize = 128,
      timeout = 10
    ) =>
      new NodejsFunction(this, id, {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname, entryFile),
        handler: 'handler',
        memorySize,
        timeout: cdk.Duration.seconds(timeout),
        environment,
      });

    // Lambda - Log Image Upload
    const logImageFn = createNodeFunction('LogImageFunction', '../lambda/log-image.ts', {
      TABLE_NAME: photoTable.tableName,
    }, 128, 10);
    photoTable.grantWriteData(logImageFn);
    logImageFn.addEventSource(new events.SqsEventSource(logQueue));
    photoBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(logQueue));

    // Lambda - Remove Image (from DLQ)
    const removeImageFn = createNodeFunction('RemoveImageFunction', '../lambda/remove-image.ts', {
      BUCKET_NAME: photoBucket.bucketName,
    }, 128, 10);
    photoBucket.grantDelete(removeImageFn);
    removeImageFn.addEventSource(new events.SqsEventSource(dlq));

    // SNS Topic for metadata/status
    const metadataTopic = new sns.Topic(this, 'MetadataTopic');

    // Add Metadata Function
    const addMetadataFn = createNodeFunction('AddMetadataFunction', '../lambda/add-metadata.ts', {
      TABLE_NAME: photoTable.tableName,
    });
    photoTable.grantWriteData(addMetadataFn);
    metadataTopic.addSubscription(new subs.LambdaSubscription(addMetadataFn, {
      filterPolicy: {
        messageType: SubscriptionFilter.stringFilter({ allowlist: ['metadata'] }),
      },
    }));

    // Update Status Function
    const updateStatusFn = createNodeFunction('UpdateStatusFunction', '../lambda/update-status.ts', {
      TABLE_NAME: photoTable.tableName,
    });
    photoTable.grantWriteData(updateStatusFn);
    metadataTopic.addSubscription(new subs.LambdaSubscription(updateStatusFn, {
      filterPolicy: {
        messageType: SubscriptionFilter.stringFilter({ allowlist: ['status'] }),
      },
    }));

    // Email Notification SNS + Lambda
    const mailerTopic = new sns.Topic(this, 'MailerTopic', {
      displayName: 'Notify Photographer of Status Update',
    });

    const mailerFn = createNodeFunction('SendStatusEmailFunction', '../lambda/status-update-mailer.ts', {
      TABLE_NAME: photoTable.tableName,
      SENDER_EMAIL: SES_EMAIL_FROM,
      RECIPIENT_EMAIL: SES_EMAIL_TO,
    }, 1024, 5);
    photoTable.grantReadData(mailerFn);
    mailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: ['*'],
      })
    );

    mailerTopic.addSubscription(new subs.LambdaSubscription(mailerFn, {
      filterPolicy: {
        messageType: SubscriptionFilter.stringFilter({ allowlist: ['notify'] }),
      },
    }));

    // Enable status function to publish to mailer topic
    mailerTopic.grantPublish(updateStatusFn);
    updateStatusFn.addEnvironment('MAILER_TOPIC_ARN', mailerTopic.topicArn);
  }
}
