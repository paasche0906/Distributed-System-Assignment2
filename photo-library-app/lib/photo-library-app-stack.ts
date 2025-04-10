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

export class PhotoLibraryAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Creating an S3 Bucket
    const imageBucket = new s3.Bucket(this, 'ImageBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create SNS Topic
    const topic = new sns.Topic(this, 'ImageTopic', {
      displayName: 'Image Upload and Metadata Topic'
    });

    // Creating a DynamoDB Table
    const imageTable = new dynamodb.Table(this, 'ImageTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Dead-Letter Queue (DLQ)
    const deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue');

    // Main Queue
    const queue = new sqs.Queue(this, 'MainQueue', {
      deadLetterQueue: {
        maxReceiveCount: 1,
        queue: deadLetterQueue,
      }
    });

    // Lambda for logging images
    const logImageLambda = new lambda.Function(this, 'LogImageLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'log-image.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: imageTable.tableName,
      }
    });

    // Grant permissions
    imageTable.grantWriteData(logImageLambda);

    // Allow Lambda to be triggered by SQS
    logImageLambda.addEventSourceMapping('LogImageEventSource', {
      eventSourceArn: queue.queueArn,
      batchSize: 1,
    });

    queue.grantConsumeMessages(logImageLambda);

    // SNS Topic subscription to SQS
    topic.addSubscription(new sns_subs.SqsSubscription(queue));

    // Lambda to remove invalid images
    const removeImageLambda = new lambda.Function(this, 'RemoveImageLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'remove-image.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        BUCKET_NAME: imageBucket.bucketName,
      }
    });

    // Grant permission to delete from S3
    imageBucket.grantDelete(removeImageLambda);

    // Configure Lambda to poll messages from DLQ
    removeImageLambda.addEventSource(new lambda_event_sources.SqsEventSource(deadLetterQueue));

    // Lambda for adding metadata
    const addMetadataLambda = new lambda.Function(this, 'AddMetadataLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'add-metadata.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: imageTable.tableName,
      }
    });

    //  Grant permission to update table
    imageTable.grantWriteData(addMetadataLambda);

    // Subscribe AddMetadataLambda to SNS topic with filter
    topic.addSubscription(new sns_subs.LambdaSubscription(addMetadataLambda, {
      filterPolicy: {
        metadata_type: sns.SubscriptionFilter.stringFilter({
          allowlist: ['Caption', 'Date', 'Name'],
        })
      }
    }));

    // Lambda for updating status
    const updateStatusLambda = new lambda.Function(this, 'UpdateStatusLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'update-status.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: imageTable.tableName,
      }
    });

    // Grant permission to update table
    imageTable.grantWriteData(updateStatusLambda);

    // Subscribe UpdateStatusLambda to SNS topic with filter
    topic.addSubscription(new sns_subs.LambdaSubscription(updateStatusLambda, {
      filterPolicy: {
        metadata_type: sns.SubscriptionFilter.exists(false)  // 没有 metadata_type 的消息
      }
    }));

  }
}
