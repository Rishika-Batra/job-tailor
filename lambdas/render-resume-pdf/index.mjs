import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import PDFDocument from "pdfkit";

const s3Client = new S3Client({});
const bucketName = process.env.BUCKET;

export const handler = async (event) => {
  try {
    const authorizer = event.requestContext?.authorizer;
    const userId = authorizer?.claims?.sub || authorizer?.jwt?.claims?.sub;
    if (!userId) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

    const { jobId } = JSON.parse(event.body || "{}");
    if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: "Missing jobId" }) };

    const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: `ats-resumes/${jobId}/structured.json` });
    const res = await s3Client.send(getCmd);
    const resume = JSON.parse(await res.Body.transformToString());

    let originalLinks = [];
    try {
      const linksCmd = new GetObjectCommand({ Bucket: bucketName, Key: `processed/${jobId}/resume-links.json` });
      const linksRes = await s3Client.send(linksCmd);
      originalLinks = JSON.parse(await linksRes.Body.transformToString());
    } catch(e) {
      console.log("No original links found or error fetching them.");
    }

    const pdfBuffer = await new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 26, autoFirstPage: true, bufferPages: true, size: 'LETTER' });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        
        const fontName = 'Helvetica';
        const fontBold = 'Helvetica-Bold';
        const fontOblique = 'Helvetica-Oblique';
        const nameSize = 15;
        const h1Size = 10.5;
        const bodySize = 9.2;
        
        const drawHeaderLine = (title) => {
          doc.moveDown(0.5);
          doc.font(fontBold).fontSize(h1Size).text(title.toUpperCase());
          doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).lineWidth(0.5).stroke();
          doc.moveDown(0.145);
        };
        
        const drawSplitLine = (leftText, rightText, fontType = fontBold, isItalicRight = false, linkUrl = null) => {
          const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          if (doc.y + doc.currentLineHeight() > doc.page.height - doc.page.margins.bottom) {
             doc.addPage();
          }
          const currentY = doc.y;
          
          if (rightText) {
            doc.font(isItalicRight ? fontOblique : fontName).fontSize(bodySize).text(rightText, doc.page.margins.left, currentY, { align: 'right', width, lineBreak: false });
          }
          
          doc.x = doc.page.margins.left;
          doc.y = currentY;
          doc.font(fontType).fontSize(bodySize).text(leftText || '', linkUrl ? { link: linkUrl } : {});
        };

        const renderBullets = (bullets) => {
          if (!bullets || bullets.length === 0) return;
          doc.moveDown(0.07);
          doc.font(fontName).fontSize(bodySize).list(bullets, { bulletRadius: 1.5, textIndent: 10, bulletIndent: 3 });
          doc.moveDown(0.12);
        };

        // HEADER
        if (resume.header) {
          if (resume.header.name) {
            doc.font(fontBold).fontSize(nameSize).text(resume.header.name, { align: 'center' });
          }
          doc.moveDown(0.145);
          
          let contactLine = [];
          if (resume.header.phone) contactLine.push(resume.header.phone);
          if (resume.header.email) contactLine.push(resume.header.email);
          if (contactLine.length > 0) {
            doc.font(fontName).fontSize(bodySize).text(contactLine.join(" | "), { align: 'center' });
          }
          
          // Any link pointing at a specific GitHub repo (not just the profile root)
          // belongs next to that project, never in the header — even for projects
          // that got cut from this tailored version.
          const isProjectLink = (l) => {
            const normalized = l.replace(/^https?:\/\//, '').replace(/^www\./, '');
            const githubRepoMatch = normalized.match(/^github\.com\/[^\/]+\/[^\/]+/);
            return !!githubRepoMatch;
          };

          let validUrls = originalLinks.filter(l => !l.startsWith('mailto:') && !isProjectLink(l));
          if (validUrls.length === 0 && resume.header.links && resume.header.links.length > 0) {
            // Fall back to the LLM-extracted links if raw PDF-annotation extraction found nothing
            validUrls = resume.header.links.filter(l => l && !l.startsWith('mailto:') && !isProjectLink(l));
          }
          if (validUrls.length > 0) {
            doc.moveDown(0.1);
            let linkTextOpts = validUrls.map(l => {
              let url = l.startsWith('http') ? l : `https://${l}`;
              let display = l.replace(/^https?:\/\/(www\.)?/, '');
              return { display, url };
            });
            
            let totalWidth = 0;
            linkTextOpts.forEach((l, i) => {
              totalWidth += doc.font(fontName).fontSize(bodySize).widthOfString(l.display);
              if (i < linkTextOpts.length - 1) totalWidth += doc.font(fontName).fontSize(bodySize).widthOfString(" | ");
            });
            
            const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
            const centerOffset = Math.max(0, (usableWidth - totalWidth) / 2);
            doc.x = doc.page.margins.left + centerOffset;
            
            // Bound the continued-text run to the remaining page width so it can never
            // silently overflow into an extra blank page.
            const remainingWidth = doc.page.width - doc.page.margins.right - doc.x;
            linkTextOpts.forEach((l, i) => {
              doc.font(fontName).fontSize(bodySize).text(l.display, { continued: i < linkTextOpts.length - 1, link: l.url, width: remainingWidth, lineBreak: false });
              if (i < linkTextOpts.length - 1) {
                doc.font(fontName).fontSize(bodySize).text(" | ", { continued: true, link: null, lineBreak: false });
              }
            });
            doc.x = doc.page.margins.left; // reset x
            doc.moveDown(0.1);
          }
        }

        // SUMMARY
        if (resume.summary) {
          drawHeaderLine('Summary');
          doc.font(fontName).fontSize(bodySize).text(resume.summary);
        }

        // EDUCATION
        if (resume.education && resume.education.length > 0) {
          drawHeaderLine('Education');
          resume.education.forEach(edu => {
            drawSplitLine(edu.degree, edu.dates, fontBold, false);
            const instText = edu.institution || '';
            const gpaText = edu.gpa || '';
            if (instText || gpaText) {
              drawSplitLine(instText, gpaText, fontName, true);
            }
            doc.moveDown(0.145);
          });
        }

        // CERTIFICATIONS
        if (resume.certifications && resume.certifications.length > 0) {
          drawHeaderLine('Certifications');
          doc.font(fontName).fontSize(bodySize).list(resume.certifications, { bulletRadius: 1.5, textIndent: 10, bulletIndent: 3 });
          doc.moveDown(0.145);
        }

        // SKILLS
        if (resume.skills && Object.keys(resume.skills).length > 0) {
          drawHeaderLine('Technical Skills');
          Object.entries(resume.skills).forEach(([category, items]) => {
            if (!items || items.length === 0) return;
            doc.font(fontBold).fontSize(bodySize).text(`${category}: `, { continued: true });
            doc.font(fontName).fontSize(bodySize).text(items.join(', '));
          });
        }

        // EXPERIENCE
        if (resume.experience && resume.experience.length > 0) {
          drawHeaderLine('Experience');
          resume.experience.forEach(exp => {
            let leftStr = exp.title || '';
            if (exp.company) leftStr += ` — ${exp.company}`;
            drawSplitLine(leftStr, exp.dates, fontBold, false);
            renderBullets(exp.bullets);
            doc.moveDown(0.145);
          });
        }

        // PROJECTS
        if (resume.projects && resume.projects.length > 0) {
          drawHeaderLine('Projects');
          resume.projects.forEach(proj => {
            let leftStr = proj.name || '';
            let href = null;
            if (proj.url) {
              const urlText = proj.url.replace(/^https?:\/\//, '');
              leftStr += ` | ${urlText}`;
              href = proj.url.startsWith('http') ? proj.url : `https://${proj.url}`;
            }
            drawSplitLine(leftStr, proj.dates, fontBold, false, href);
            if (proj.tech) {
              doc.font(fontOblique).fontSize(bodySize).text(proj.tech);
            }
            renderBullets(proj.bullets);
            doc.moveDown(0.145);
          });
        }

        // OTHER SECTIONS
        if (resume.other_sections && resume.other_sections.length > 0) {
          resume.other_sections.forEach(section => {
            if (!section.sectionTitle || !section.entries) return;
            drawHeaderLine(section.sectionTitle);
            section.entries.forEach(entry => {
              drawSplitLine(entry.title, entry.dates, fontBold, false);
              renderBullets(entry.bullets);
              doc.moveDown(0.145);
            });
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

    const downloadUrl = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucketName, Key: pdfKey }), { expiresIn: 3600 });
    return { statusCode: 200, body: JSON.stringify({ downloadUrl }) };
  } catch (error) {
    console.error("Error rendering PDF:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
