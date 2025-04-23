import { SNSEvent } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = new DynamoDBClient({});
const tableName = process.env.TABLE_NAME;

if (!tableName) {
    throw new Error('TABLE_NAME environment variable is not set.');
}

const allowedMetadataTypes = new Set(['Caption', 'Date', 'Name']);

export const handler = async (event: SNSEvent): Promise<void> => {
    console.log('Received SNS Event:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        try {
            const sns = record.Sns;
            const message = JSON.parse(sns.Message);
            const metadataType = sns.MessageAttributes?.metadata_type?.Value;
            const imageId = message.id;
            const metadataValue = message.value;

            if (!metadataType || !allowedMetadataTypes.has(metadataType)) {
                console.warn(`Skipped record due to invalid metadata_type: ${metadataType}`);
                continue;
            }

            const command = new UpdateItemCommand({
                TableName: tableName,
                Key: { id: { S: imageId } },
                UpdateExpression: 'SET #attr = :val',
                ExpressionAttributeNames: { '#attr': metadataType },
                ExpressionAttributeValues: { ':val': { S: metadataValue } },
            });

            await ddb.send(command);
            console.log(`Updated ${metadataType} for image: ${imageId}`);

        } catch (error) {
            console.error('Error processing record:', record, error);
        }
    }
};
