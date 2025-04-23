import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as events from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambdanode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from "path";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { SubscriptionFilter } from "aws-cdk-lib/aws-sns";
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import { SES_EMAIL_FROM, SES_EMAIL_TO } from '../env';

export class PhotoLibraryAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket for photo uploads
    const bucket = new s3.Bucket(this, 'PhotoGalleryBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // DynamoDB Table for photo info
    const table = new dynamodb.Table(this, 'PhotoGalleryTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // SQS Queues
    const dlq = new sqs.Queue(this, 'ImageDLQ');
    const logQueue = new sqs.Queue(this, 'ImageLogQueue', {
      deadLetterQueue: {
        maxReceiveCount: 1,
        queue: dlq,
      },
    });

    // Lambda - LogImage
    const logImageFn = new lambdanode.NodejsFunction(this, 'LogImageFunction', {
      runtime: lambda.Runtime.NODEJS_16_X,
      entry: `${__dirname}/../lambdas/logImage.ts`,
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    table.grantWriteData(logImageFn);
    logImageFn.addEventSource(new events.SqsEventSource(logQueue));

    // S3 -> Send upload events to queue
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(logQueue)
    );

    // Lambda - RemoveImage
    const removeImageFn = new lambdanode.NodejsFunction(this, 'RemoveImageFunction', {
      runtime: lambda.Runtime.NODEJS_16_X,
      entry: `${__dirname}/../lambdas/removeImage.ts`,
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
    });

    bucket.grantDelete(removeImageFn);
    removeImageFn.addEventSource(new events.SqsEventSource(dlq));

    const addMetadataFunction = new NodejsFunction(this, "AddMetadataFunction", {
      entry: path.join(__dirname, "../lambdas/addMetadata.ts"),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    table.grantWriteData(addMetadataFunction);

    // SNS Topic for metadata updates
    const snsTopic = new sns.Topic(this, 'MetadataTopic');

    snsTopic.addSubscription(
      new subscriptions.LambdaSubscription(addMetadataFunction, {
        filterPolicy: {
          messageType: SubscriptionFilter.stringFilter({
            allowlist: ["metadata"],
          }),
        },
      })
    );

    const updateStatusFunction = new NodejsFunction(this, "UpdateStatusFunction", {
      entry: path.join(__dirname, "../lambdas/updateStatus.ts"),
      environment: {
        TABLE_NAME: table.tableName
      },
    });

    table.grantWriteData(updateStatusFunction);

    snsTopic.addSubscription(
      new subscriptions.LambdaSubscription(updateStatusFunction, {
        filterPolicy: {
          messageType: SubscriptionFilter.stringFilter({
            allowlist: ["status"],
          }),
        },
      })
    );

    // Create an email notification SNS Topic
    const mailerTopic = new sns.Topic(this, "MailerTopic", {
      displayName: "Notify Photographer of Status Update",
    });

    // Create an Emailing Lambda Function
    const mailerFunction = new lambdaNodejs.NodejsFunction(this, "SendStatusEmailFunction", {
      entry: path.join(__dirname, "../lambdas/sendEmail.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(5),
      environment: {
        TABLE_NAME: table.tableName,
        SENDER_EMAIL: SES_EMAIL_FROM,
        RECIPIENT_EMAIL: SES_EMAIL_TO,
      },
    });


    mailerTopic.addSubscription(new subs.LambdaSubscription(mailerFunction));
    mailerTopic.addSubscription(
      new subs.LambdaSubscription(mailerFunction, {
        filterPolicy: {
          messageType: sns.SubscriptionFilter.stringFilter({
            allowlist: ["notify"],
          }),
        },
      })
    );

    // Permission settings: Mailer Lambda can read tables and send emails
    table.grantReadData(mailerFunction);
    mailerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: ["*"],
      })
    );

    // Enable updateStatusFunction to publish SNS messages
    mailerTopic.grantPublish(updateStatusFunction);
    updateStatusFunction.addEnvironment("MAILER_TOPIC_ARN", mailerTopic.topicArn);
  }
}
