import { SNSEvent } from 'aws-lambda';
import * as AWS from 'aws-sdk';

const ddb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME!;

export const handler = async (event: SNSEvent): Promise<void> => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        const sns = record.Sns;
        const message = JSON.parse(sns.Message);
        const attributes = sns.MessageAttributes;

        const imageId = message.id;
        const value = message.value;

        const metadataType = attributes['metadata_type']?.Value;

        if (!metadataType || !['Caption', 'Date', 'Name'].includes(metadataType)) {
            console.error('Invalid metadata type');
            throw new Error('Invalid metadata type');
        }

        const updateExpression = `set ${metadataType} = :val`;
        const expressionAttributeValues = { ':val': value };

        await ddb.update({
            TableName: tableName,
            Key: { id: imageId },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues
        }).promise();

        console.log(`Metadata ${metadataType} updated for ${imageId}`);
    }
};
