import path from 'node:path';
import {
  Document,
  Font,
  Link,
  Page,
  Path,
  StyleSheet,
  Svg,
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
  buyVsEarn,
  cents,
  clip,
  conversionRange,
  countryName,
  engineLabel,
  firstDaySteps,
  money,
  percent,
  planOffers,
  questionGroups,
  questionSummary,
  quickWins,
  revenueRows,
  totals,
  valueRows,
} from './rules';

/**
 * The free AI visibility report card as a PDF (REPORT-CARD §1): four A4
 * pages, the results, "What's in Ansvisor and how you can use it", the
 * outcomes and the questions asked. It is drawn on the server, on the Reports PDF's base: the same
 * renderer, Inter, Ansvisor's look without a kit (reportLook) and its
 * footer. English throughout; the questions stay in the language they were
 * asked in, and Inter carries Turkish and other Latin letters.
 */

const FAMILY = 'ReportCardInter';
/**
 * Ansvisor's own colors (the brand style guide, owner decision 2026-11-03):
 * ink for text, rules, the company's own bars and buttons; a warm grey for
 * secondary text and for the competitors' bars, lighter; a cream band and a
 * sand border. No color is used for anything but these.
 */
const INK = '#1C1A17';
const TEXT = INK;
const MUTED = '#464442';
const BAND = '#F0EEEA';
const BORDER = '#EBE6DE';
const TRACK = BAND;
const COMPETITOR = '#464442';
const COMPETITOR_OPACITY = 0.35;
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
  rule: { height: 2, marginTop: 10, marginBottom: 14, backgroundColor: INK },
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
    backgroundColor: INK,
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
  feature: { fontSize: 8, fontWeight: 700, color: INK, marginTop: 2, marginBottom: 1 },
  stepText: { fontSize: 8.5, lineHeight: 1.35 },
  box: { borderWidth: 0.5, borderColor: BORDER, borderRadius: 4, padding: 9 },
  tinted: { backgroundColor: BAND, borderColor: BORDER },
  link: { color: INK, fontWeight: 700, textDecoration: 'underline' },
  compact: { fontSize: 8.5, lineHeight: 1.35 },
  tight: { marginBottom: 9 },
  qRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingVertical: 2.5,
  },
  qText: { fontSize: 7.5, lineHeight: 1.25 },
  legend: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    backgroundColor: BAND,
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  qCell: { width: 52, textAlign: 'center' },
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
            {
              width: `${Math.min(Math.max(pct, 0), 100)}%`,
              backgroundColor: color,
              opacity: color === COMPETITOR ? COMPETITOR_OPACITY : 1,
            },
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
          <Text style={styles.kpiValue}>{visibility}%</Text>
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
            color={INK}
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
                color={'own' in c ? INK : COMPETITOR}
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
              color={s.own ? INK : COMPETITOR}
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
          {card.audience === 'readers' ? 'reader' : 'buyer'} might ask
          {card.products?.length
            ? ' about the main products on your site, kept those that match what you sell best'
            : ', from your site'}
          , and asked each one once in {card.engines.map((e) => engineLabel(e.engine)).join(', ')}{' '}
          in {countryName(card.country)}, in {card.language}, on {date}. AI answers change from day
          to day, so this is a snapshot. Visibility here is the share of answers that name you; the
          AI Visibility Score in Ansvisor also weighs citations and how early you’re named.
          {(card.questionRows?.length ?? 0) > 0
            ? ` All ${card.questionRows?.length} questions are on page 4.`
            : ''}
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

/** Page 3: the outcomes. Compact, so the revenue scenario fits on it too. */
function OutcomesPage({ card, family }: PageProps) {
  const values = valueRows(card);
  const revenue = revenueRows(card);
  const offers = planOffers();
  const compare = buyVsEarn(card);
  const rate = conversionRange(card.siteType);
  const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
  const currency = card.dealValue?.currency ?? 'USD';
  const text = [styles.compact];
  const muted = [styles.compact, styles.muted];

  return (
    <Page size="A4" style={pageStyle(family)}>
      <Header
        eyebrow="Outcomes"
        title="What you can achieve, and what it’s worth"
        subtitle="Three goals, the Ansvisor features that work toward each, and what AI visits would be worth to you."
      />

      <View style={[styles.tight, styles.row]} wrap={false}>
        {OUTCOME_GOALS.map((goal) => (
          <View key={goal.title} style={[styles.kpiBox, { padding: 7 }]}>
            <Text style={[...text, styles.bold, { marginBottom: 2 }]}>{goal.title}</Text>
            <Text style={muted}>{goal.features.join(' · ')}</Text>
          </View>
        ))}
      </View>

      <View style={styles.tight} wrap={false}>
        <Text style={[styles.sectionTitle, { marginBottom: 3 }]}>
          Buying these visits vs earning them
        </Text>
        {values && card.cpc && compare ? (
          <>
            <Text style={[...muted, { marginBottom: 4 }]}>
              Google Ads’ median cost per click for your questions’ keywords in{' '}
              {countryName(card.country)}: {cents(card.cpc.usd)} ({card.cpc.keywords} of{' '}
              {card.questionCount} keywords had one).
            </Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 1 }]}>AI visits a month</Text>
              <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Ads a month</Text>
              <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Ads a year</Text>
            </View>
            {values.map((row) => (
              <View key={row.visits} style={[styles.tr, { paddingVertical: 2.5 }]}>
                <Text style={[styles.td, { flex: 1 }]}>{formatNumber(row.visits)}</Text>
                <Text style={[styles.td, styles.bold, { flex: 1, textAlign: 'right' }]}>
                  {money(row.monthly)}
                </Text>
                <Text style={[styles.td, { flex: 1, textAlign: 'right' }]}>
                  {money(row.yearly)}
                </Text>
              </View>
            ))}
            <View style={[styles.row, { marginTop: 6 }]}>
              <View style={[styles.box, { flex: 1, padding: 7 }]}>
                <Text style={styles.eyebrow}>Buying them</Text>
                <Text style={[...text, styles.bold, { marginTop: 2 }]}>
                  {formatNumber(compare.visits)} AI visits a month ≈ {money(compare.adsMonthly)} in
                  Google Ads, every month.
                </Text>
                <Text style={muted}>
                  Ad clicks stop when the budget stops. Over 12 months: ≈ {money(compare.adsYearly)}
                  , bought again every month.
                </Text>
              </View>
              <View style={[styles.box, styles.tinted, { flex: 1, padding: 7 }]}>
                <Text style={styles.eyebrow}>Earning them</Text>
                <Text style={[...text, styles.bold, { marginTop: 2 }]}>
                  Ansvisor Growth is {money(compare.growthMonthly)} a month.
                </Text>
                <Text style={muted}>
                  Pages that AI engines cite can keep sending visits month after month, for as long
                  as they’re cited. Over 12 months: {money(compare.growthTwelveMonths)}, or{' '}
                  {money(compare.growthYearly)} paid yearly.
                </Text>
              </View>
            </View>
          </>
        ) : (
          <Text style={muted}>
            Not enough ad data for your topics in {countryName(card.country)}.
          </Text>
        )}
      </View>

      <View style={[styles.tight, styles.box, { padding: 7 }]} wrap={false}>
        <Text style={[...text, styles.bold, { marginBottom: 1 }]}>
          AI answers can lead to Google searches for your name
        </Text>
        <Text style={muted}>
          Many AI answers send no click. Some people may still search for your name on Google later,
          or type your address, so being named can show up as more searches and clicks for your
          brand and as direct visits. In Ansvisor, AI Traffic Analytics shows the visits AI
          assistants send and, with Search Console connected, whether AI is changing your Google
          traffic.
        </Text>
      </View>

      <View style={[styles.tight, styles.row]} wrap={false}>
        {offers.map((o) => (
          <View key={o.plan} style={[styles.box, { flex: 1, padding: 7 }]}>
            <Text style={[...text, styles.bold]}>
              Ansvisor {o.name}: {money(o.monthly)}/month
              <Text style={styles.muted}> · or {money(o.yearly)} a year, paid yearly</Text>
            </Text>
            {o.points.map((point) => (
              <Text key={point} style={muted}>
                · {point}
              </Text>
            ))}
          </View>
        ))}
      </View>

      {!card.dealValue && (
        <View style={[styles.box, styles.tight, { padding: 7 }]} wrap={false}>
          <Text style={[...text, styles.bold, { marginBottom: 1 }]}>
            How to get the revenue line
          </Text>
          <Text style={muted}>
            Give your average order or deal value when you ask for your next report card, and this
            page adds a revenue scenario. In Ansvisor, AI Traffic counts the signups, demo requests
            and orders that AI visits bring, once conversions are on.
          </Text>
        </View>
      )}

      {revenue && card.dealValue && (
        <View style={styles.tight} wrap={false}>
          <Text style={[styles.sectionTitle, { marginBottom: 3 }]}>A revenue scenario</Text>
          <Text style={[...muted, { marginBottom: 4 }]}>
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
            <View key={row.visits} style={[styles.tr, { paddingVertical: 2.5 }]}>
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

      <View style={[styles.box, styles.tinted, { marginTop: 'auto', padding: 7 }]} wrap={false}>
        <Text style={[...text, styles.bold]}>Scenarios, not a forecast or a guarantee.</Text>
        <Text style={text}>
          Ansvisor’s AI Traffic measures your real visits from AI answers once it’s set up. Every
          figure on this page is labelled with the assumption it rests on.
        </Text>
        <Link src={REPORT_CARD_SIGN_UP_URL} style={[...text, styles.link, { marginTop: 3 }]}>
          Start a free trial at app.ansvisor.com
        </Link>
      </View>
      <Footer />
    </Page>
  );
}

/** The engines' short names, for page 4's narrow columns. */
const SHORT_ENGINE: Record<string, string> = {
  'chatgpt-web': 'ChatGPT',
  'gemini-web': 'Gemini',
  'google-aio': 'AI Overviews',
  'google-aimode': 'AI Mode',
};

/** A check mark, drawn in ink: Inter has no glyph for one. */
function Tick() {
  return (
    <Svg width={10} height={10} viewBox="0 0 12 12">
      <Path d="M1.8 6.4 L4.9 9.5 L10.6 2.8" stroke={INK} strokeWidth={2.4} fill="none" />
    </Svg>
  );
}

/** A dash or "n/a": light, so the ticks stand out. */
function Faint({ children }: { children: string }) {
  return <Text style={[styles.qText, { color: MUTED, opacity: 0.5 }]}>{children}</Text>;
}

/** Page 4: every question asked, by product, and what each engine did with it. */
function QuestionsPage({ card, family }: PageProps) {
  const groups = questionGroups(card);
  const count = groups.reduce((sum, g) => sum + g.lines.length, 0);
  const summary = questionSummary(card);
  const engines = card.engines.map((e) => e.engine);
  const withProducts = groups.some((g) => g.product);
  const withVolume = groups.some((g) => g.lines.some((l) => l.volume !== null));
  return (
    <Page size="A4" style={pageStyle(family)}>
      <Header
        eyebrow="What we measured"
        title={`The ${count} questions we asked`}
        subtitle={
          withProducts
            ? `Written from the main products on ${clip(card.domain, 60)} and kept for how closely they match what you sell and how often people search for them. As asked in ${countryName(card.country)}, in ${card.language}. “Named instead” is the brand its answers named most.`
            : `As asked in ${countryName(card.country)}, in ${card.language}. “Named instead” is the brand its answers named most.`
        }
      />
      {summary && (
        <Text style={[styles.paragraph, styles.bold, { marginBottom: 6 }]}>{summary}</Text>
      )}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <Tick />
          <Text style={styles.qText}>Named</Text>
        </View>
        <View style={styles.legendItem}>
          <Faint>–</Faint>
          <Text style={styles.qText}>Not named</Text>
        </View>
        <View style={styles.legendItem}>
          <Faint>n/a</Faint>
          <Text style={styles.qText}>No answer</Text>
        </View>
        {withVolume && (
          <Text style={[styles.qText, { color: MUTED }]}>
            Searches: Google searches a month for the question’s keyword
          </Text>
        )}
      </View>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: 16 }]}>#</Text>
        <Text style={[styles.th, { flex: 1 }]}>Question</Text>
        {withVolume && (
          <Text style={[styles.th, { width: 44, textAlign: 'right', paddingRight: 6 }]}>
            Searches
          </Text>
        )}
        {engines.map((engine) => (
          <Text key={engine} style={[styles.th, styles.qCell]}>
            {SHORT_ENGINE[engine] ?? engineLabel(engine)}
          </Text>
        ))}
        <Text style={[styles.th, { width: 96 }]}>Named instead</Text>
      </View>
      {groups.map((group) => (
        <View key={group.product ?? 'other'}>
          {group.product && (
            <Text style={[styles.qText, styles.bold, { marginTop: 5, marginBottom: 1 }]}>
              {group.product}
              <Text style={{ color: MUTED, fontWeight: 400 }}>
                {' '}
                · {group.lines.length} {group.lines.length === 1 ? 'question' : 'questions'}
                {group.page ? ` · ${group.page}` : ''}
              </Text>
            </Text>
          )}
          {group.lines.map((line) => (
            <View key={`${line.number}-${line.text}`} style={styles.qRow} wrap={false}>
              <Text style={[styles.qText, { width: 16, color: MUTED }]}>{line.number}</Text>
              <Text style={[styles.qText, { flex: 1, paddingRight: 6 }]}>
                {line.text}
                {line.fit === 'related' ? (
                  <Text style={{ color: MUTED }}> (a need your buyers also have)</Text>
                ) : null}
              </Text>
              {withVolume && (
                <Text style={[styles.qText, { width: 44, textAlign: 'right', paddingRight: 6 }]}>
                  {line.volume === null ? '–' : formatNumber(line.volume)}
                </Text>
              )}
              {engines.map((engine) => (
                <View key={engine} style={[styles.qCell, { alignItems: 'center' }]}>
                  {line.named[engine] === 'named' ? (
                    <Tick />
                  ) : (
                    <Faint>{line.named[engine] === 'missed' ? '–' : 'n/a'}</Faint>
                  )}
                </View>
              ))}
              <Text style={[styles.qText, { width: 96, color: MUTED }]}>{line.instead ?? '—'}</Text>
            </View>
          ))}
        </View>
      ))}
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
      {(card.questionRows?.length ?? 0) > 0 && <QuestionsPage card={card} family={family} />}
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
