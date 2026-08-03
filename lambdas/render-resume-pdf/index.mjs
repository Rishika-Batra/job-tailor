import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import PDFDocument from "pdfkit";

const s3Client = new S3Client({});
const bucketName = process.env.BUCKET;

export const handler = async (event) => {
  try {
    const authorizer = event.requestContext?.authorizer;
    const userId = authorizer?.claims?.sub || authorizer?.jwt?.claims?.sub;
    
    if (!userId) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing request body" }) };
    }
    
    const { jobId } = JSON.parse(event.body);
    if (!jobId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing jobId" }) };
    }

    const s3Key = `ats-resumes/${jobId}/structured.json`;
    let structuredResumeStr;
    try {
      const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: s3Key });
      const res = await s3Client.send(getCmd);
      structuredResumeStr = await res.Body.transformToString();
    } catch (err) {
      console.error(`Error fetching structured resume from S3 (${s3Key}):`, err);
      return { statusCode: 404, body: JSON.stringify({ error: "Structured resume not found" }) };
    }

    const resume = JSON.parse(structuredResumeStr);
    
    // Generate PDF in memory
    const pdfBuffer = await new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 54 }); // 0.75 inch = 54 points
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        
        // Font settings
        const fontName = 'Helvetica';
        const fontBold = 'Helvetica-Bold';
        const h1Size = 12;
        const bodySize = 10;
        
        // Helper to draw a section header
        const drawHeader = (title) => {
          doc.moveDown(1);
          doc.font(fontBold).fontSize(h1Size).text(title.toUpperCase());
          doc.moveDown(0.2);
        };
        
        // SUMMARY
        if (resume.summary) {
          drawHeader('Summary');
          doc.font(fontName).fontSize(bodySize).text(resume.summary);
        }
        
        // SKILLS
        if (resume.skills && resume.skills.length > 0) {
          drawHeader('Skills');
          doc.font(fontName).fontSize(bodySize).text(resume.skills.join(', '));
        }
        
        // EXPERIENCE
        if (resume.experience && resume.experience.length > 0) {
          drawHeader('Experience');
          resume.experience.forEach(exp => {
            doc.font(fontBold).fontSize(bodySize).text(exp.title || '', { continued: true });
            
            let continuedStr = '';
            if (exp.company) continuedStr += ` | ${exp.company}`;
            if (exp.dates) continuedStr += ` | ${exp.dates}`;
            
            if (continuedStr) {
              doc.font(fontName).text(continuedStr);
            } else {
              doc.text(''); // end line
            }
            
            if (exp.bullets) {
              doc.moveDown(0.2);
              exp.bullets.forEach(bullet => {
                doc.font(fontName).fontSize(bodySize).text(`• ${bullet}`, { indent: 15 });
              });
            }
            doc.moveDown(0.5);
          });
        }
        
        // PROJECTS
        if (resume.projects && resume.projects.length > 0) {
          drawHeader('Projects');
          resume.projects.forEach(proj => {
            doc.font(fontBold).fontSize(bodySize).text(proj.name || '', { continued: proj.tech ? true : false });
            if (proj.tech) {
              doc.font(fontName).text(` | ${proj.tech}`);
            } else {
              doc.text('');
            }
            
            if (proj.bullets) {
              doc.moveDown(0.2);
              proj.bullets.forEach(bullet => {
                doc.font(fontName).fontSize(bodySize).text(`• ${bullet}`, { indent: 15 });
              });
            }
            doc.moveDown(0.5);
          });
        }
        
        // EDUCATION
        if (resume.education && resume.education.length > 0) {
          drawHeader('Education');
          resume.education.forEach(edu => {
            doc.font(fontBold).fontSize(bodySize).text(edu.degree || '', { continued: true });
            
            let continuedStr = '';
            if (edu.institution) continuedStr += ` | ${edu.institution}`;
            if (edu.dates) continuedStr += ` | ${edu.dates}`;
            
            if (continuedStr) {
              doc.font(fontName).text(continuedStr);
            } else {
              doc.text(''); // end line
            }
            doc.moveDown(0.5);
          });
        }
        
        // CERTIFICATIONS
        if (resume.certifications && resume.certifications.length > 0) {
          drawHeader('Certifications');
          resume.certifications.forEach(cert => {
            doc.font(fontName).fontSize(bodySize).text(`• ${cert}`, { indent: 15 });
          });
        }
        
        doc.end();
      } catch (err) {
        reject(err);
      }
    });

    const pdfKey = `ats-resumes/${jobId}/resume.pdf`;
    
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: pdfKey,
      Body: pdfBuffer,
      ContentType: "application/pdf"
    }));

    const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: pdfKey });
    const downloadUrl = await getSignedUrl(s3Client, getCmd, { expiresIn: 3600 });

    return {
      statusCode: 200,
      body: JSON.stringify({ downloadUrl })
    };
  } catch (error) {
    console.error("Error rendering PDF:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
