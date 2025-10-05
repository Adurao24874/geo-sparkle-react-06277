import { Button } from '@/components/ui/button';
import { exportClimateReport, generatePdfReport, PdfSection } from '@/lib/pdfReport';
import { useCallback } from 'react';

export default function DownloadReportButton({
  fileName = 'climate-report.pdf',
  sections,
  disabled,
}: {
  fileName?: string;
  sections?: PdfSection[];
  disabled?: boolean;
}) {
  const onClick = useCallback(async () => {
    try {
      if (sections && sections.length) {
        await generatePdfReport(sections, { fileName });
      } else {
        await exportClimateReport(fileName);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('PDF export failed', e);
      alert('Sorry, failed to generate the PDF.');
    }
  }, [fileName, sections]);

  return (
    <Button variant="secondary" onClick={onClick} disabled={disabled}>
      Download PDF
    </Button>
  );
}
