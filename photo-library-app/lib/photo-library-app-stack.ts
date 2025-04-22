import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
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

    // === Base Resources ===
    const imageBucket = this.createS3Bucket();
    const topic = this.createSnsTopic();
    const imageTable = this.createDynamoTable();

    // === Queues ===
    const { queue, deadLetterQueue } = this.createQueues();

    // === Lambdas ===
    this.setupLogImageLambda(queue, imageTable);
    this.setupRemoveImageLambda(deadLetterQueue, imageBucket);
    this.setupAddMetadataLambda(topic, imageTable);
    this.setupUpdateStatusLambda(topic, imageTable);
    this.setupStatusUpdateMailerLambda(imageTable);

    // Output S3 bucket name
    new cdk.CfnOutput(this, 'ImageBucketName', {
      value: imageBucket.bucketName,
    });
  }

  private createS3Bucket(): s3.Bucket {
    return new s3.Bucket(this, 'ImageBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }

  private createSnsTopic(): sns.Topic {
    return new sns.Topic(this, 'ImageTopic', {
      displayName: 'Image Upload and Metadata Topic'
    });
  }

  private createDynamoTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'ImageTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
    });
  }

  private createQueues() {
    const deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue');
    const queue = new sqs.Queue(this, 'MainQueue', {
      deadLetterQueue: {
        maxReceiveCount: 1,
        queue: deadLetterQueue,
      }
    });
    return { queue, deadLetterQueue };
  }

  private setupLogImageLambda(queue: sqs.Queue, imageTable: dynamodb.Table) {
    const fn = new lambda.Function(this, 'LogImageLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'log-image.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: imageTable.tableName,
      }
    });

    imageTable.grantWriteData(fn);
    fn.addEventSourceMapping('LogImageEventSource', {
      eventSourceArn: queue.queueArn,
      batchSize: 1,
    });
    queue.grantConsumeMessages(fn);
  }

  private setupRemoveImageLambda(deadLetterQueue: sqs.Queue, bucket: s3.Bucket) {
    const fn = new lambda.Function(this, 'RemoveImageLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'remove-image.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        BUCKET_NAME: bucket.bucketName,
      }
    });

    bucket.grantDelete(fn);
    fn.addEventSource(new lambda_event_sources.SqsEventSource(deadLetterQueue));
  }

  private setupAddMetadataLambda(topic: sns.Topic, imageTable: dynamodb.Table) {
    const fn = new lambda.Function(this, 'AddMetadataLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'add-metadata.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: imageTable.tableName,
      }
    });

    imageTable.grantWriteData(fn);
    topic.addSubscription(new sns_subs.LambdaSubscription(fn, {
      filterPolicy: {
        metadata_type: sns.SubscriptionFilter.stringFilter({
          allowlist: ['Caption', 'Date', 'Name'],
        })
      }
    }));
  }

  private setupUpdateStatusLambda(topic: sns.Topic, imageTable: dynamodb.Table) {
    const fn = new lambda.Function(this, 'UpdateStatusLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'update-status.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: imageTable.tableName,
      }
    });

    imageTable.grantWriteData(fn);
    topic.addSubscription(new sns_subs.LambdaSubscription(fn, {
      filterPolicy: {
        metadata_type: sns.SubscriptionFilter.stringFilter({
          denylist: ['Caption', 'Date', 'Name'],
        }),
      }
    }));
  }

  private setupStatusUpdateMailerLambda(imageTable: dynamodb.Table) {
    const fn = new lambda.Function(this, 'StatusUpdateMailerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'status-update-mailer.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        FROM_EMAIL: SES_EMAIL_FROM,
        TO_EMAIL: SES_EMAIL_TO,
        SES_REGION: SES_REGION,
        TABLE_NAME: imageTable.tableName,
      }
    });

    fn.addEventSource(new lambda_event_sources.DynamoEventSource(imageTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 5,
    }));

    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));
  }
}
