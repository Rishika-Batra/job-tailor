import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const bucketName = process.env.BUCKET;
const tableName = process.env.TABLE;

export const handler = async (event) => {
  const jobId = event.pathParameters && event.pathParameters.jobId;

  if (!jobId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'jobId is required' })
    };
  }

  const getResult = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { jobId }
    })
  );

  const record = getResult.Item;

  if (!record) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'not found' })
    };
  }

  if (record.status !== 'complete') {
    return {
      statusCode: 200,
      body: JSON.stringify({ status: record.status })
    };
  }

  // Fetch the full result JSON from S3
  const getObjectCmd = new GetObjectCommand({
    Bucket: bucketName,
    Key: record.resultKey
  });
  const s3Response = await s3Client.send(getObjectCmd);
  const resultText = await s3Response.Body.transformToString();
  const result = JSON.parse(resultText);

  return {
    statusCode: 200,
    body: JSON.stringify({ status: 'complete', result })
  };
};
