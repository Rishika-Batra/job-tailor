import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import crypto from "crypto";

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sfnClient = new SFNClient({});

const bucketName = process.env.BUCKET;
const tableName = process.env.TABLE;
const stateMachineArn = process.env.STATE_MACHINE_ARN;

export const handler = async (event) => {
  try {
    const authorizer = event.requestContext?.authorizer;
    const userId = authorizer?.claims?.sub || authorizer?.jwt?.claims?.sub;
    
    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { resumeBase64, jdText } = body;

    if (!resumeBase64 || !jdText) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "resumeBase64 and jdText are required" }),
      };
    }

    const jobId = crypto.randomUUID();

    // Decode resume
    const resumeBuffer = Buffer.from(resumeBase64, "base64");

    // Upload resume to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: `raw/${jobId}/resume.pdf`,
        Body: resumeBuffer,
        ContentType: "application/pdf",
      })
    );

    // Upload JD to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: `raw/${jobId}/jd.txt`,
        Body: jdText,
        ContentType: "text/plain",
      })
    );

    // Save to DynamoDB
    const createdAt = new Date().toISOString();
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          jobId,
          userId,
          status: "processing",
          createdAt,
        },
      })
    );

    // Start Step Functions Execution
    await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: stateMachineArn,
        input: JSON.stringify({ jobId }),
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ jobId }),
    };
  } catch (error) {
    console.error("Error processing request:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
