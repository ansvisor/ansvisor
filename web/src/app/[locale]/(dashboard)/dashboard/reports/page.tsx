import { PLATFORM_LABELS } from "@/config/platform-labels";
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileDown, Plus } from 'lucide-react';

export default function ReportsPage() {
  const t = useTranslations('reports');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2">
            <FileDown className="h-4 w-4" />
            {t('downloadPDF')}
          </Button>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            {t('generateReport')}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generated Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No reports generated yet. Run at least one prompt analysis to generate your first
            report.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
