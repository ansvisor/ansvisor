import path from 'node:path';
import {
  Document,
  Font,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import { formatDate, formatNumber } from '@/lib/format';
import { reportLook } from '@/lib/white-label/kit';
import type { ReportCardPayload } from './payload';
import {
  OUTCOME_GOALS,
  REPORT_CARD_SIGN_UP_URL,
  actionPlan,
  cents,
  clip,
  conversionRange,
  countryName,
  engineLabel,
  firstDaySteps,
  money,
  percent,
  times,
  planMonthly,
  planOffers,
  quickWins,
  revenueRows,
  totals,
  valueRows,
} from './rules';

/**
 * The free AI visibility report card as a PDF (REPORT-CARD §1): three A4
 * pages, the results, "What's in Ansvisor and how you can use it" and the
 * outcomes. It is drawn on the server, on the Reports PDF's base: the same
 * renderer, Inter, Ansvisor's look without a kit (reportLook) and its
 * footer. English throughout; the questions stay in the language they were
 * asked in, and Inter carries Turkish and other Latin letters.
 */

const FAMILY = 'ReportCardInter';
const TEXT = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const TRACK = '#f3f4f6';
const TINT = '#eef2ff';
const COMPETITOR = '#94a3b8';
const LINE = 1.4;
/** A domain has no space to wrap at: what fits a bar's label. */
const DOMAIN_MAX = 25;

const look = reportLook(null);

/** Cards drawn by this server: each one registers Inter under a family of its own. */
let drawn = 0;

/**
 * Inter from `dir` (public/fonts by default), as a family for one card: the
 * renderer keeps a registered family's font subset from the first card it
 * draws, so a later card lost every letter the first one didn't use (a
 * Turkish card after an English one printed "Kış sporları" as "ış sporlar").
 * The family it registered, removed again once the card is drawn.
 */
function registerFonts(dir: string): string {
  drawn += 1;
  const family = `${FAMILY}-${drawn}`;
  Font.register({
    family,
    fonts: [
      { src: path.join(dir, 'Inter-Regular.ttf'), fontWeight: 400 },
      { src: path.join(dir, 'Inter-Bold.ttf'), fontWeight: 700 },
    ],
  });
  // Word-splitting hyphenation looks broken in tables; wrap whole words only.
  Font.registerHyphenationCallback((word) => [word]);
  return family;
}

const styles = StyleSheet.create({
  // Its font is the card's own family: pageStyle.
  pageBox: {
    fontSize: 9,
    color: TEXT,
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 52,
  },
  eyebrow: { fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 16, fontWeight: 700, marginTop: 3 },
  subtitle: { fontSize: 9, color: MUTED, marginTop: 4, lineHeight: LINE },
  rule: { height: 2, marginTop: 10, marginBottom: 14, backgroundColor: look.accent },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  paragraph: { fontSize: 9, lineHeight: LINE },
  muted: { color: MUTED },
  small: { fontSize: 7.5, color: MUTED, lineHeight: LINE },
  row: { flexDirection: 'row', gap: 10 },
  kpiBox: { flex: 1, borderWidth: 0.5, borderColor: BORDER, borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 7, color: MUTED, textTransform: 'uppercase', marginBottom: 3 },
  kpiValue: { fontSize: 18, fontWeight: 700 },
  kpiValueSmall: { fontSize: 11, fontWeight: 700, marginTop: 3, marginBottom: 3 },
  kpiSub: { fontSize: 7, color: MUTED, marginTop: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  barLabel: { width: 112, fontSize: 8, paddingRight: 6 },
  barTrack: { flex: 1, height: 6, backgroundColor: TRACK, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  barValue: { width: 72, fontSize: 8, textAlign: 'right' },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: 4,
    marginBottom: 2,
  },
  th: { fontSize: 7, fontWeight: 700, color: MUTED, textTransform: 'uppercase' },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingVertical: 4,
    alignItems: 'center',
  },
  td: { fontSize: 8 },
  bold: { fontWeight: 700 },
  win: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  number: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: look.accent,
    color: '#ffffff',
    fontSize: 8,
    fontWeight: 700,
    textAlign: 'center',
    paddingTop: 3.5,
  },
  step: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
  },
  feature: { fontSize: 8, fontWeight: 700, color: look.textAccent, marginTop: 2, marginBottom: 1 },
  stepText: { fontSize: 8.5, lineHeight: 1.35 },
  box: { borderWidth: 0.5, borderColor: BORDER, borderRadius: 4, padding: 9 },
  tinted: { backgroundColor: TINT, borderColor: look.accent },
  link: { color: look.textAccent, fontWeight: 700, textDecoration: 'none' },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: MUTED },
});

/** A page of the card, in the card's own Inter (registerFonts). */
const pageStyle = (family: string) => [styles.pageBox, { fontFamily: family }];

/** A page's card, and the family its Inter is registered as for it. */
type PageProps = { card: ReportCardPayload; family: string };

function Bar({
  label,
  pct,
  value,
  color,
  strong = false,
}: {
  label: string;
  pct: number;
  value: string;
  color: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.barRow}>
      <Text style={[styles.barLabel, strong ? styles.bold : {}]}>{clip(label, 48)}</Text>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.min(Math.max(pct, 0), 100)}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={[styles.barValue, strong ? styles.bold : {}]}>{value}</Text>
    </View>
  );
}

function Header({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <View style={styles.rule} />
    </View>
  );
}

function Footer() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{look.footer ?? ''}</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

/** Page 1: the results. */
function ResultsPage({ card, family }: PageProps) {
  const { answers, named, visibility } = totals(card);
  const leader = card.competitors[0];
  const rivals = card.competitors.slice(0, 3);
  const most = Math.max(named, ...rivals.map((c) => c.answers), 1);
  const cited = card.citedSites.slice(0, 5);
  const mostCited = Math.max(...cited.map((s) => s.answers), 1);
  const date = formatDate(card.generatedAt);

  return (
    <Page size="A4" style={pageStyle(family)}>
      <Header
        eyebrow="Free AI visibility report card"
        title={`How visible is ${clip(card.companyName, 60)} in AI answers?`}
        subtitle={`${clip(card.domain, 60)} · ${card.country.name}, in ${card.language} · ${date}`}
      />

      <View style={[styles.section, styles.row]} wrap={false}>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>AI visibility</Text>
          <Text style={[styles.kpiValue, { color: look.textAccent }]}>{visibility}%</Text>
          <Text style={styles.kpiSub}>
            named in {named} of {answers} answers
          </Text>
        </View>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>Questions asked</Text>
          <Text style={styles.kpiValue}>{card.questionCount}</Text>
          <Text style={styles.kpiSub}>
            in {card.engines.length} AI engines: {answers} answers
          </Text>
        </View>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>Top competitor</Text>
          <Text style={styles.kpiValueSmall}>{leader ? clip(leader.name, 40) : 'None named'}</Text>
          <Text style={styles.kpiSub}>
            {leader ? `named in ${leader.answers} of ${answers} answers` : 'in these answers'}
          </Text>
        </View>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>Your site cited</Text>
          <Text style={styles.kpiValue}>{card.ownCitations}</Text>
          <Text style={styles.kpiSub}>of {answers} answers cite a page of yours</Text>
        </View>
      </View>

      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>Visibility by engine</Text>
        {card.engines.map((e) => (
          <Bar
            key={e.engine}
            label={engineLabel(e.engine)}
            pct={percent(e.named, e.answers)}
            value={`${e.named} of ${e.answers} · ${percent(e.named, e.answers)}%`}
            color={look.accent}
          />
        ))}
      </View>

      <View style={[styles.section, styles.row]} wrap={false}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Who AI names</Text>
          {rivals.length === 0 && (
            <Text style={[styles.paragraph, styles.muted]}>No competitor was named.</Text>
          )}
          {[{ name: card.companyName, answers: named, own: true }, ...rivals]
            .sort((a, b) => b.answers - a.answers)
            .map((c) => (
              <Bar
                key={c.name}
                label={'own' in c ? `${c.name} (you)` : c.name}
                pct={(c.answers / most) * 100}
                value={`${c.answers} answers`}
                color={'own' in c ? look.accent : COMPETITOR}
                strong={'own' in c}
              />
            ))}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Sites AI cites most</Text>
          {cited.length === 0 && (
            <Text style={[styles.paragraph, styles.muted]}>No sites were cited.</Text>
          )}
          {cited.map((s) => (
            <Bar
              key={s.domain}
              label={s.own ? `${clip(s.domain, DOMAIN_MAX)} (you)` : clip(s.domain, DOMAIN_MAX)}
              pct={(s.answers / mostCited) * 100}
              value={`${s.answers} answers`}
              color={s.own ? look.accent : COMPETITOR}
              strong={s.own}
            />
          ))}
        </View>
      </View>

      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>3 things to do now</Text>
        {quickWins(card).map((win, i) => (
          <View key={win.title} style={styles.win}>
            <Text style={styles.number}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.paragraph, styles.bold]}>{win.title}</Text>
              <Text style={[styles.paragraph, styles.muted]}>{win.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.box, { marginTop: 'auto' }]} wrap={false}>
        <Text style={styles.small}>
          How we measured: we wrote {card.questionCount} questions a{' '}
          {card.audience === 'readers' ? 'reader' : 'buyer'} might ask, from your site, and asked
          each one once in {card.engines.map((e) => engineLabel(e.engine)).join(', ')} in{' '}
          {countryName(card.country)}, in {card.language}, on {date}. AI answers change from day to
          day, so this is a snapshot. Visibility here is the share of answers that name you; the AI
          Visibility Score in Ansvisor also weighs citations and how early you’re named.
        </Text>
      </View>
      <Footer />
    </Page>
  );
}

/** Page 2: the action plan. */
function PlanPage({ card, family }: PageProps) {
  const plan = actionPlan(card);
  const sources = [...new Set(plan.flatMap((step) => step.lines.map((line) => line.title)))].join(
    ', ',
  );
  return (
    <Page size="A4" style={pageStyle(family)}>
      <Header
        eyebrow="Your action plan"
        title="What’s in Ansvisor and how you can use it"
        subtitle={`Built from ${clip(card.companyName, 60)}’s results: each finding, the Ansvisor feature that works on it, what it does and what it’s for.`}
      />

      {plan.map((step, i) => (
        <View key={step.feature} style={styles.step} wrap={false}>
          <Text style={styles.number}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.paragraph, styles.bold]}>{step.finding}</Text>
            <Text style={styles.feature}>Ansvisor · {step.feature}</Text>
            {step.lines.map((line) => (
              <Text key={line.article} style={styles.stepText}>
                {line.text}
              </Text>
            ))}
            <Text style={[styles.stepText, { marginTop: 1 }]}>
              <Text style={styles.bold}>Aim: </Text>
              {step.aim}
            </Text>
          </View>
        </View>
      ))}
      <Text style={[styles.small, { marginTop: 6 }]}>
        What each feature does is quoted from its Help article: {sources}.
      </Text>

      <View style={[styles.box, styles.tinted, { marginTop: 'auto' }]} wrap={false}>
        <Text style={[styles.sectionTitle, { marginBottom: 4 }]}>Start your free trial</Text>
        <Text style={[styles.paragraph, { marginBottom: 4 }]}>
          Set this plan up on your first day:
        </Text>
        {firstDaySteps(card).map((line, i) => (
          <Text key={line} style={styles.paragraph}>
            {i + 1}. {line}
          </Text>
        ))}
        <Link
          src={REPORT_CARD_SIGN_UP_URL}
          style={[styles.paragraph, styles.link, { marginTop: 6 }]}
        >
          Start a free trial at app.ansvisor.com
        </Link>
      </View>
      <Footer />
    </Page>
  );
}

/** Page 3: the outcomes. */
function OutcomesPage({ card, family }: PageProps) {
  const values = valueRows(card);
  const revenue = revenueRows(card);
  const offers = planOffers();
  const growth = offers.find((o) => o.plan === 'growth');
  const middle = values?.[1];
  const rate = conversionRange(card.siteType);
  const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
  const currency = card.dealValue?.currency ?? 'USD';

  return (
    <Page size="A4" style={pageStyle(family)}>
      <Header
        eyebrow="Outcomes"
        title="What you can achieve, and what it’s worth"
        subtitle="Three goals, the Ansvisor features that work toward each, and what AI visits would be worth to you."
      />

      <View style={[styles.section, styles.row]} wrap={false}>
        {OUTCOME_GOALS.map((goal) => (
          <View key={goal.title} style={styles.kpiBox}>
            <Text style={[styles.paragraph, styles.bold, { marginBottom: 4 }]}>{goal.title}</Text>
            {goal.features.map((f) => (
              <Text key={f} style={[styles.paragraph, styles.muted]}>
                · {f}
              </Text>
            ))}
          </View>
        ))}
      </View>

      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>What the same visits would cost in Google Ads</Text>
        {values && card.cpc ? (
          <>
            <Text style={[styles.paragraph, styles.muted, { marginBottom: 6 }]}>
              The median Google Ads cost per click for your questions’ keywords in{' '}
              {countryName(card.country)} is {cents(card.cpc.usd)} ({card.cpc.keywords} of{' '}
              {card.questionCount} keywords had one).
            </Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 1.2 }]}>AI visits a month</Text>
              <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Google Ads a month</Text>
              <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>A year</Text>
              {offers.map((o) => (
                <Text key={o.plan} style={[styles.th, { flex: 1.1, textAlign: 'right' }]}>
                  vs {o.name} {money(o.monthly)}/mo
                </Text>
              ))}
            </View>
            {values.map((row) => (
              <View key={row.visits} style={styles.tr}>
                <Text style={[styles.td, { flex: 1.2 }]}>{formatNumber(row.visits)}</Text>
                <Text style={[styles.td, styles.bold, { flex: 1, textAlign: 'right' }]}>
                  {money(row.monthly)}
                </Text>
                <Text style={[styles.td, { flex: 1, textAlign: 'right' }]}>
                  {money(row.yearly)}
                </Text>
                {offers.map((o) => (
                  <Text key={o.plan} style={[styles.td, { flex: 1.1, textAlign: 'right' }]}>
                    {times(row.multiple[o.plan])}
                  </Text>
                ))}
              </View>
            ))}
            {middle && growth && (
              <Text style={[styles.paragraph, { marginTop: 6 }]}>
                <Text style={styles.bold}>
                  {formatNumber(middle.visits)} AI visits ≈ {money(middle.monthly)} a month in
                  Google Ads
                </Text>{' '}
                vs {money(planMonthly('growth'))} a month for Ansvisor Growth.
              </Text>
            )}
          </>
        ) : (
          <Text style={[styles.paragraph, styles.muted]}>
            Not enough ad data for your topics in {countryName(card.country)}.
          </Text>
        )}
      </View>

      <View style={[styles.section, styles.row]} wrap={false}>
        {offers.map((o) => (
          <View key={o.plan} style={[styles.box, { flex: 1 }]}>
            <Text style={[styles.paragraph, styles.bold]}>Ansvisor {o.name}</Text>
            <Text style={[styles.kpiValueSmall, { color: look.textAccent }]}>
              {money(o.monthly)}/month
            </Text>
            <Text style={[styles.small, { marginBottom: 4 }]}>
              or {money(o.yearly)} a year, paid yearly
            </Text>
            {o.points.map((p) => (
              <Text key={p} style={styles.paragraph}>
                · {p}
              </Text>
            ))}
          </View>
        ))}
      </View>

      {!card.dealValue && (
        <View style={[styles.box, styles.section]} wrap={false}>
          <Text style={[styles.paragraph, styles.bold, { marginBottom: 2 }]}>
            How to get the revenue line
          </Text>
          <Text style={[styles.paragraph, styles.muted]}>
            Give your average order or deal value when you ask for your next report card, and this
            page adds a revenue scenario. In Ansvisor, AI Traffic counts the signups, demo requests
            and orders that AI visits bring, once conversions are on.
          </Text>
        </View>
      )}

      {revenue && card.dealValue && (
        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>A revenue scenario</Text>
          <Text style={[styles.paragraph, styles.muted, { marginBottom: 6 }]}>
            Your average {rate.kind} value: {money(card.dealValue.amount, currency)}. Assumption:{' '}
            {pct(rate.low)} of visits {rate.kind === 'order' ? 'place an order' : 'become a deal'}{' '}
            (range {pct(rate.low)}–{pct(rate.high)}). AI visits are not assumed to convert better
            than others.
          </Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { flex: 1.2 }]}>AI visits a month</Text>
            <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>
              Revenue a month at {pct(rate.low)}
            </Text>
            <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>
              Range ({pct(rate.low)}–{pct(rate.high)})
            </Text>
            <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>
              A year at {pct(rate.low)}
            </Text>
          </View>
          {revenue.map((row) => (
            <View key={row.visits} style={styles.tr}>
              <Text style={[styles.td, { flex: 1.2 }]}>{formatNumber(row.visits)}</Text>
              <Text style={[styles.td, styles.bold, { flex: 1, textAlign: 'right' }]}>
                {money(row.low, currency)}
              </Text>
              <Text style={[styles.td, { flex: 1, textAlign: 'right' }]}>
                {money(row.low, currency)}–{money(row.high, currency)}
              </Text>
              <Text style={[styles.td, { flex: 1, textAlign: 'right' }]}>
                {money(row.low * 12, currency)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.box, styles.tinted, { marginTop: 'auto' }]} wrap={false}>
        <Text style={[styles.paragraph, styles.bold]}>
          Scenarios, not a forecast or a guarantee.
        </Text>
        <Text style={styles.paragraph}>
          Ansvisor’s AI Traffic measures your real visits from AI answers once it’s set up. Every
          figure on this page is labelled with the assumption it rests on.
        </Text>
        <Link
          src={REPORT_CARD_SIGN_UP_URL}
          style={[styles.paragraph, styles.link, { marginTop: 6 }]}
        >
          Start a free trial at app.ansvisor.com
        </Link>
      </View>
      <Footer />
    </Page>
  );
}

/** `family`: the Inter registerFonts registered for this card. */
export function ReportCardPdfDocument({ card, family }: PageProps) {
  return (
    <Document
      title={`AI visibility report card: ${clip(card.companyName, 60)}`}
      author={look.author}
      creator={look.author}
    >
      <ResultsPage card={card} family={family} />
      <PlanPage card={card} family={family} />
      <OutcomesPage card={card} family={family} />
    </Document>
  );
}

/** The card's PDF. `fontDir` holds Inter-Regular.ttf and Inter-Bold.ttf: public/fonts by default. */
export async function reportCardPdf(
  card: ReportCardPayload,
  fontDir: string = path.join(process.cwd(), 'public', 'fonts'),
): Promise<Uint8Array> {
  const family = registerFonts(fontDir);
  try {
    return new Uint8Array(
      await renderToBuffer(<ReportCardPdfDocument card={card} family={family} />),
    );
  } finally {
    // Drawn: its family goes, so a server drawing many cards doesn't keep them all.
    delete Font.getRegisteredFonts()[family];
  }
}
