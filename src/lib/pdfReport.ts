// Lightweight DOM-to-PDF report generator using html2canvas + jsPDF
// Captures specified DOM sections (by element IDs) and builds a multi-page portrait PDF.

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export type PdfSection = {
  id: string;           // DOM element id to capture
  title?: string;       // optional section heading in PDF
  marginTop?: number;   // extra spacing before this section (in mm)
};

export type PdfOptions = {
  fileName?: string;
  pageFormat?: 'a4' | 'letter';
  imageQuality?: number;   // 0..1
  scale?: number;          // canvas scale for clarity
  background?: string;     // canvas background color
  titles?: {
    analysis?: string;
    charts?: string;
  };
};

const MM_PER_PX = 0.2645833333; // 96dpi to mm

async function captureElementToImage(el: HTMLElement, scale = 2, background = '#ffffff') {
  // Clone the element and render the clone offscreen at its full scroll size.
  const clone = el.cloneNode(true) as HTMLElement;
  // Reset styles that might interfere
  clone.style.position = 'absolute';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.zIndex = '99999';
  clone.style.width = `${el.scrollWidth}px`;
  clone.style.height = `${el.scrollHeight}px`;
  clone.style.overflow = 'visible';

  // Disable animations/transitions on cloned tree for stable capture
  clone.querySelectorAll && clone.querySelectorAll('*').forEach((n: Element) => {
    (n as HTMLElement).style.transition = 'none';
    (n as HTMLElement).style.animation = 'none';
  });

  document.body.appendChild(clone);
  try {
    // Copy bitmap content from any original canvases into corresponding cloned canvases.
    try {
      const origCanvases = Array.from(el.querySelectorAll('canvas')) as HTMLCanvasElement[];
      const cloneCanvases = Array.from(clone.querySelectorAll('canvas')) as HTMLCanvasElement[];
      for (let i = 0; i < origCanvases.length; i++) {
        const o = origCanvases[i];
        const c = cloneCanvases[i];
        if (!o || !c) continue;
        try {
          // Ensure clone has same size
          c.width = o.width;
          c.height = o.height;
          const data = o.toDataURL('image/png');
          // draw into cloned canvas
          await new Promise<void>((resolve) => {
            const img = new Image();
            // Allow cross-origin images to load (if useCORS used when drawing original)
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              try {
                const ctx = c.getContext('2d');
                if (ctx) {
                  ctx.clearRect(0, 0, c.width, c.height);
                  ctx.drawImage(img, 0, 0, c.width, c.height);
                }
              } catch (er) {
                // ignore
              }
              resolve();
            };
            img.onerror = () => resolve();
            img.src = data;
          });
        } catch (err) {
          // ignore per-canvas errors and continue
        }
      }
    } catch (err) {
      // ignore canvas-copying errors
    }

    const canvas = await html2canvas(clone, {
      backgroundColor: background,
      scale,
      useCORS: true,
      logging: false,
      width: clone.scrollWidth,
      height: clone.scrollHeight,
      windowWidth: clone.scrollWidth,
      windowHeight: clone.scrollHeight,
    });
    const dataUrl = canvas.toDataURL('image/png');
    return { dataUrl, widthPx: canvas.width, heightPx: canvas.height };
  } finally {
    // Clean up clone
    try { document.body.removeChild(clone); } catch (e) { /* ignore */ }
  }
}

export async function generatePdfReport(sections: PdfSection[], opts?: PdfOptions) {
  const fileName = opts?.fileName || 'climate-report.pdf';
  const format = opts?.pageFormat || 'a4';
  const quality = opts?.imageQuality ?? 0.92;
  const scale = opts?.scale ?? 2;
  const bg = opts?.background ?? '#ffffff';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let isFirstPage = true;

  for (const section of sections) {
    const el = document.getElementById(section.id);
    if (!el) continue;

    const { dataUrl, widthPx, heightPx } = await captureElementToImage(el, scale, bg);

    // Convert px to mm
    const imgWidthMm = widthPx * MM_PER_PX;
    const imgHeightMm = heightPx * MM_PER_PX;

    // Fit to page width with aspect ratio
    const renderWidth = pageWidth - 20; // 10mm margin on both sides
    const ratio = renderWidth / imgWidthMm;
    const renderHeight = imgHeightMm * ratio;

    const neededPages = Math.ceil(renderHeight / (pageHeight - 20));

    for (let i = 0; i < neededPages; i++) {
      if (!isFirstPage) doc.addPage();
      isFirstPage = false;

      const yOffset = 10; // top margin
      const xOffset = 10; // left margin

      // Optional title on page top for the first chunk of a section
      if (section.title && i === 0) {
        doc.setFontSize(14);
        doc.setTextColor(30);
        doc.text(section.title, xOffset, yOffset);
      }

      const availableHeight = pageHeight - 20 - (section.title && i === 0 ? 8 : 0);
      const chunkHeight = Math.min(availableHeight, renderHeight - i * (pageHeight - 20));

      // Calculate the slice of the image to draw on this page by using the image as a whole but shifting the crop via 'sHeight'
      const pageYStart = i * (pageHeight - 20);

      // jsPDF doesn't support drawing sub-rects of images directly; workaround: scale full image and shift via canvas cropping is heavy.
      // Simpler approach: draw full image scaled and move it upward so only needed slice is visible in page.
      const drawY = yOffset + (section.title && i === 0 ? 8 : 0) - pageYStart;

      doc.addImage(dataUrl, 'PNG', xOffset, drawY, renderWidth, renderHeight, undefined, 'FAST');
    }
  }

  doc.save(fileName);
}

// Single-page version: captures multiple sections and scales them to fit 1 page.
export async function generateSinglePagePdf(sections: PdfSection[], opts?: PdfOptions) {
  const fileName = opts?.fileName || 'climate-report.pdf';
  const format = opts?.pageFormat || 'a4';
  const scale = opts?.scale ?? 2;
  const bg = opts?.background ?? '#ffffff';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Capture all sections first
  const captures: Array<{ id: string; dataUrl: string; widthPx: number; heightPx: number } | null> = [];
  for (const s of sections) {
    const el = document.getElementById(s.id);
    if (!el) { captures.push(null); continue; }
    const cap = await captureElementToImage(el as HTMLElement, scale, bg);
    captures.push({ id: s.id, ...cap });
  }

  // Compute total height if rendered to page width with margins
  const margin = 10; // mm
  const renderWidth = pageWidth - margin * 2;
  const heights: number[] = [];
  let totalHeight = 0;
  for (const cap of captures) {
    if (!cap) { heights.push(0); continue; }
    const imgWidthMm = cap.widthPx * MM_PER_PX;
    const imgHeightMm = cap.heightPx * MM_PER_PX;
    const ratio = renderWidth / imgWidthMm;
    const h = imgHeightMm * ratio;
    heights.push(h);
    totalHeight += h;
  }

  const availableHeight = pageHeight - margin * 2;
  const scaleFactor = totalHeight > 0 ? Math.min(1, availableHeight / totalHeight) : 1;

  let y = margin;
  for (let i = 0; i < captures.length; i++) {
    const cap = captures[i];
    if (!cap) continue;
    const h = heights[i] * scaleFactor;
    const imgWidthMm = cap.widthPx * MM_PER_PX;
    const ratio = renderWidth / imgWidthMm;
    const fullRenderHeight = cap.heightPx * MM_PER_PX * ratio;
    const scaledHeight = fullRenderHeight * scaleFactor;
    doc.addImage(cap.dataUrl, 'PNG', margin, y, renderWidth, scaledHeight, undefined, 'FAST');
    y += h; // move down by scaled chunk height
  }

  doc.save(fileName);
}

// Two-page version: page 1 = analysis (fit to page), page 2 = charts (fit full chart on page)
export async function generateTwoPagePdf(analysisId: string, chartsId: string, opts?: PdfOptions) {
  const fileName = opts?.fileName || 'climate-report.pdf';
  const format = opts?.pageFormat || 'a4';
  const scale = opts?.scale ?? 2;
  const bg = opts?.background ?? '#ffffff';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10; // mm
  const availW = pageWidth - margin * 2;
  const availH = pageHeight - margin * 2;
  const titleFontSize = 14; // mm-ish for layout (we still set font in points)
  const titles = opts?.titles || {};

  // Capture analysis
  const elA = document.getElementById(analysisId) as HTMLElement | null;
  if (elA) {
    const { dataUrl, widthPx, heightPx } = await captureElementToImage(elA, scale, bg);
    const imgW = widthPx * MM_PER_PX;
    const imgH = heightPx * MM_PER_PX;
    // Reserve space for optional title
    const titleSpace = titles.analysis ? 10 : 0; // mm
    const availHForImage = availH - titleSpace;
    // Allow downscaling as much as needed so the image always fits even if small
      const r = Math.min(availW / imgW, availHForImage / imgH);
    const w = imgW * r;
    const h = imgH * r;
    const x = margin + (availW - w) / 2;
    let y = margin;
    if (titles.analysis) {
      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      // Use darker text for light background; if dark theme captured, white works better
      try {
        doc.setTextColor(30);
      } catch {}
      doc.text(titles.analysis, margin + 2, y + 6);
      y += titleSpace; // shift image down to make room for title
    }
    // center vertically in remaining area
    y = y + (availHForImage - h) / 2;
    doc.addImage(dataUrl, 'PNG', x, y, w, h, undefined, 'FAST');
  }

  // Page 2: charts
  doc.addPage();
  const elC = document.getElementById(chartsId) as HTMLElement | null;
  if (elC) {
    const { dataUrl, widthPx, heightPx } = await captureElementToImage(elC, scale, bg);
    const imgW = widthPx * MM_PER_PX;
    const imgH = heightPx * MM_PER_PX;
    const titleSpace = titles.charts ? 10 : 0;
    const availHForImage = availH - titleSpace;
    const r = Math.min(availW / imgW, availHForImage / imgH);
  // Use computed fit scale (no extra shrink)
  const w = imgW * r;
  const h = imgH * r;
    const x = margin + (availW - w) / 2;
    let y = margin;
    if (titles.charts) {
      doc.setFontSize(16);
      try { doc.setTextColor(30); } catch {}
      doc.text(titles.charts, margin + 2, y + 6);
      y += titleSpace;
    }
    y = y + (availHForImage - h) / 2;
    doc.addImage(dataUrl, 'PNG', x, y, w, h, undefined, 'FAST');
  }

  doc.save(fileName);
}

// Convenience helper: default export is a 2-page report
export async function exportClimateReport(defaultName = 'climate-report.pdf') {
  return generateTwoPagePdf('report-analysis', 'report-charts', {
    fileName: defaultName,
    pageFormat: 'a4',
    scale: 2,
    background: '#ffffff',
    titles: { analysis: 'Analysis Summary', charts: 'Climatology & Distribution' },
  });
}
