import { DynamoDBStreamEvent } from 'aws-lambda';
import * as AWS from 'aws-sdk';
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from '../env';

const ses = new AWS.SES({ region: SES_REGION });

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        if (record.eventName !== 'MODIFY') continue;

        const newImage = record.dynamodb?.NewImage;
        const oldImage = record.dynamodb?.OldImage;

        if (!oldImage?.status && newImage?.status) {
            const imageId = newImage.id.S;
            const status = newImage.status.S;
            const photographerName = newImage.Name?.S || "Photographer";

            const emailParams = {
                Source: SES_EMAIL_FROM,
                Destination: {
                    ToAddresses: [SES_EMAIL_TO],
                },
                Message: {
                    Subject: {
                        Data: `Image Status Update: ${status}`,
                    },
                    Body: {
                        Text: {
                            Data: `Hello ${photographerName},\n\nYour image '${imageId}' has been reviewed. Status: ${status}.`,
                        },
                    },
                },
            };

            await ses.sendEmail(emailParams).promise();
            console.log(`Sent email about ${imageId} status change.`);
            console.log(`Sent email about ${imageId} status change.`);
        }
    }
};
