import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SNSEvent } from "aws-lambda";

const ddbClient = new DynamoDBClient({});
const snsClient = new SNSClient({});

const tableName = process.env.TABLE_NAME;
const mailerTopicArn = process.env.MAILER_TOPIC_ARN;

if (!tableName || !mailerTopicArn) {
    throw new Error("Missing required environment variables: TABLE_NAME or MAILER_TOPIC_ARN");
}

export const handler = async (event: SNSEvent): Promise<void> => {
    for (const record of event.Records) {
        try {
            const message = JSON.parse(record.Sns.Message);
            const { id, date, update, email } = message;

            if (!id || !email || !update?.status || !["Pass", "Reject"].includes(update.status)) {
                console.warn(`Invalid message content: ${JSON.stringify(message)}`);
                continue;
            }

            // Update DynamoDB status
            await ddbClient.send(
                new UpdateItemCommand({
                    TableName: tableName,
                    Key: { id: { S: id } },
                    UpdateExpression: "SET #s = :s, #r = :r, #d = :d",
                    ExpressionAttributeNames: {
                        "#s": "status",
                        "#r": "reason",
                        "#d": "date",
                    },
                    ExpressionAttributeValues: {
                        ":s": { S: update.status },
                        ":r": { S: update.reason ?? "N/A" },
                        ":d": { S: date },
                    },
                })
            );

            console.log(`Updated status for image: ${id} to ${update.status}`);

            // Send to mailer SNS topic
            await snsClient.send(
                new PublishCommand({
                    TopicArn: mailerTopicArn,
                    Message: JSON.stringify({ id, email, date, update }),
                    MessageAttributes: {
                        messageType: {
                            DataType: "String",
                            StringValue: "notify",
                        },
                    },
                })
            );

            console.log(`📨 Sent notification to mailer for: ${email}`);

        } catch (error) {
            console.error(`Failed to process record:`, record, error);
        }
    }
};
