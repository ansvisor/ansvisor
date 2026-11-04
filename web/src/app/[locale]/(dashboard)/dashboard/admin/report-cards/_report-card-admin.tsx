import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { ReportCardStats } from '@/lib/report-card/admin';

const usd = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

function Stat({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="px-4 text-sm text-muted-foreground">{sub}</CardContent>}
    </Card>
  );
}

/** The view, from the figures read on the server. */
export function ReportCardAdmin({ stats }: { stats: ReportCardStats }) {
  const t = useTranslations('reportCardAdmin');
  const { today, month } = stats;
  const columns = [
    'requests',
    'resent',
    'capped',
    'started',
    'ready',
    'failed',
    'cost',
    'emailsSent',
    'emailsFailed',
  ] as const;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat
          title={t('today')}
          value={t('todayValue', { started: today.started, cap: stats.dailyCap })}
          sub={t('todaySub', {
            requests: today.requests,
            resent: today.resent,
            capped: today.capped,
          })}
        />
        <Stat
          title={t('month')}
          value={t('monthValue', { cost: usd(month.costUsd), budget: usd(month.budgetUsd) })}
          sub={t('monthSub', { cards: month.cards })}
        />
        <Stat
          title={t('errorRate')}
          value={stats.errorRate === null ? t('errorRateNone') : `${stats.errorRate}%`}
        />
        <Stat title={t('queued')} value={formatNumber(stats.queued)} />
        <Stat title={t('optIns')} value={formatNumber(stats.marketingOptIns)} />
      </div>

      <Card className="py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base">{t('byDay')}</CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.date')}</TableHead>
                {columns.map((column) => (
                  <TableHead key={column} className="text-right">
                    {t(`columns.${column}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.days.map((day) => (
                <TableRow key={day.date}>
                  <TableCell className="tabular-nums">{day.date}</TableCell>
                  {columns.map((column) => (
                    <TableCell key={column} className="text-right tabular-nums">
                      {column === 'cost' ? usd(day.costUsd) : formatNumber(day[column])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base">{t('failures')}</CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          {stats.failures.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noFailures')}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {stats.failures.map((failure) => (
                <li key={`${failure.site}-${failure.at}`} className="flex flex-col">
                  <span className="font-medium">
                    {failure.site} · {formatDateTime(failure.at)}
                  </span>
                  <span className="text-muted-foreground">{failure.error}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
