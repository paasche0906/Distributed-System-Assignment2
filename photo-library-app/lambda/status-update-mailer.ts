import { SNSEvent } from "aws-lambda";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SES_EMAIL_FROM } from "../env";

const ddb = new DynamoDBClient({});
const ses = new SESClient({ region: "eu-west-1" });

const tableName = process.env.TABLE_NAME;

if (!tableName || !SES_EMAIL_FROM) {
    throw new Error("Missing required environment variables: TABLE_NAME or SES_EMAIL_FROM");
}

export const handler = async (event: SNSEvent): Promise<void> => {
    console.log("Received SNS Event:", JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        try {
            const { id, email } = JSON.parse(record.Sns.Message);
            if (!id || !email) {
                console.warn("Missing required fields in SNS message:", record.Sns.Message);
                continue;
            }

            // Fetch status info from DynamoDB
            const result = await ddb.send(
                new GetItemCommand({
                    TableName: tableName,
                    Key: { id: { S: id } },
                })
            );

            const item = result.Item;
            const status = item?.status?.S ?? "Unknown";
            const reason = item?.reason?.S ?? "No reason provided";
            const date = item?.date?.S ?? "Unknown";
            const name = item?.Name?.S ?? "Photographer";

            // Build email content
            const subject = `Image Review Result for '${id}'`;
            const body = `Hello ${name},\n\nYour image '${id}' has been reviewed.\n\nStatus: ${status}\nReason: ${reason}\nDate: ${date}\n\nBest regards,\nPhoto Review Team`;

            // Send email
            await ses.send(
                new SendEmailCommand({
                    Source: SES_EMAIL_FROM,
                    Destination: { ToAddresses: [email] },
                    Message: {
                        Subject: { Data: subject },
                        Body: { Text: { Data: body } },
                    },
                })
            );

            console.log(`Email sent to ${email} for image: ${id}`);

        } catch (error) {
            console.error("Error processing SNS record:", record, error);
        }
    }
};
