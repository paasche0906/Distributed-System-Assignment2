import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns_subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';

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
  }
}
