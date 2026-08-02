import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  try {
    const userId = event.requestContext?.authorizer?.jwt?.claims?.sub;

    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    const bucket = process.env.BUCKET;
    const table = process.env.TABLE;

    const scanResult = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "userId = :uid AND #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":uid": userId,
          ":status": "complete",
        },
      })
    );

    const jobs = scanResult.Items || [];

    if (jobs.length < 2) {
      return {
        statusCode: 200,
        body: JSON.stringify({ trends: [], jobCount: jobs.length }),
      };
    }

    const gapCounts = new Map();

    await Promise.all(
      jobs.map(async (job) => {
        if (!job.resultKey) return;
        try {
          const resultObj = await s3.send(
            new GetObjectCommand({ Bucket: bucket, Key: job.resultKey })
          );
          const resultText = await resultObj.Body.transformToString();
          const result = JSON.parse(resultText);

          const gaps = result.gaps || [];
          for (const gap of gaps) {
            if (!gap.requirement) continue;
            const normalized = gap.requirement.trim().toLowerCase();
            if (!gapCounts.has(normalized)) {
              gapCounts.set(normalized, {
                requirement: gap.requirement.trim(),
                count: 0,
                jobIds: new Set(),
              });
            }
            const entry = gapCounts.get(normalized);
            entry.count += 1;
            entry.jobIds.add(job.jobId);
          }
        } catch (err) {
          console.error(`Failed to process job ${job.jobId}:`, err);
        }
      })
    );

    const trends = Array.from(gapCounts.values())
      .map((entry) => ({
        requirement: entry.requirement,
        count: entry.count,
        jobIds: Array.from(entry.jobIds),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      statusCode: 200,
      body: JSON.stringify({ trends, jobCount: jobs.length }),
    };
  } catch (err) {
    console.error("gap-trends error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
