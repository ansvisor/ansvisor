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
import { reportLook } from '@/lib/white-label/kit';
import { cardCopy, type CardCopy } from './copy';
import type { ReportCardEngine, ReportCardPayload } from './payload';
import {
  REPORT_CARD_SIGN_UP_URL,
  STARTER_ENGINES,
  adsVerdict,
  alsoNamed,
  buyVsEarn,
  cents,
  clip,
  conversionRange,
  count,
  engineLabel,
  engineList,
  examplePrompt,
  growthEngineRows,
  kindOf,
  mainEngineRows,
  mainTotals,
  money,
  percent,
  planBrands,
  planMonthly,
  planPrompts,
  planYearly,
  productNames,
  questionDemand,
  questionGroups,
  questionSummary,
  quickWins,
  revenueRows,
  startingPoint,
  targetGroups,
  topMissed,
  totals,
  valueRows,
} from './rules';

/**
 * The free AI visibility report card as a PDF (REPORT-CARD §1; the v5
 * layout, owner decisions 2026-11-04): four A4 pages, in the card's
 * language (./copy.ts):
 *
 *   1. Status: a one-time snapshot, how the card read the site, the four
 *      figures, the starting point and first step, Starter's engines with
 *      Growth's apart, who AI names and cites, and the questions missed.
 *   2. Questions: every question by product, its searches, a grid of what
 *      each engine did, and the competitor named instead.
 *   3. Plan: three findings with what you'd do in week one, the sites to
 *      get onto by kind, and how the work gets done.
 *   4. Value and plan: AI visits priced at the brand's own search demand,
 *      the plan that matches the card, and the one trial invitation.
 *
 * Drawn on the server, on the Reports PDF's base: the same renderer, Inter,
 * Ansvisor's look without a kit (reportLook) and its footer.
 */

const FAMILY = 'ReportCardInter';
/**
 * Ansvisor's own colors (the brand style guide, owner decision 2026-11-03):
 * ink for text, rules, the company's own bars and buttons; a warm grey for
 * secondary text and for the competitors' bars, lighter; a cream band and a
 * sand border.
 */
const INK = '#1C1A17';
const TEXT = INK;
const MUTED = '#464442';
const BAND = '#F0EEEA';
const BORDER = '#EBE6DE';
const TRACK = BAND;
const COMPETITOR = '#464442';
const COMPETITOR_OPACITY = 0.35;
/** The grid's "answered, didn't name you": a sand cell, lighter than ink. */
const MISSED_CELL = '#DDD6CB';
const LINE = 1.4;
/** A domain has no space to wrap at: what fits a bar's label. */
const DOMAIN_MAX = 25;

const look = reportLook(null);

let renders = 0;

/**
 * Inter from `dir` (public/fonts by default), under a family of its own for
 * one card. react-pdf keeps a loaded font's glyph subset: a second card
 * drawn with the same family in the same server printed some letters wrong
 * (a Turkish card's "Kış" came out as "ış"), so each card loads Inter afresh
 * and drops its family once drawn (unregisterFonts).
 */
function registerFonts(dir: string): string {
  renders += 1;
  const family = `${FAMILY}-${renders}`;
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

function unregisterFonts(family: string) {
  delete (Font.getRegisteredFonts() as Record<string, unknown>)[family];
}

const styles = StyleSheet.create({
  page: {
    fontSize: 9,
    color: TEXT,
    paddingTop: 32,
    paddingHorizontal: 40,
    paddingBottom: 48,
  },
  eyebrow: { fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 16, fontWeight: 700, marginTop: 3 },
  subtitle: { fontSize: 8.5, color: MUTED, marginTop: 3, lineHeight: LINE },
  rule: { height: 2, marginTop: 8, marginBottom: 10, backgroundColor: INK },
  section: { marginBottom: 11 },
  sectionTitle: { fontSize: 10.5, fontWeight: 700, marginBottom: 5 },
  paragraph: { fontSize: 8.5, lineHeight: LINE },
  muted: { color: MUTED },
  small: { fontSize: 7.5, color: MUTED, lineHeight: LINE },
  row: { flexDirection: 'row', gap: 10 },
  kpiBox: { flex: 1, borderWidth: 0.5, borderColor: BORDER, borderRadius: 4, padding: 7 },
  kpiLabel: { fontSize: 7, color: MUTED, textTransform: 'uppercase', marginBottom: 3 },
  kpiValue: { fontSize: 18, fontWeight: 700 },
  kpiValueSmall: { fontSize: 11, fontWeight: 700, marginTop: 3, marginBottom: 3 },
  kpiSub: { fontSize: 7, color: MUTED, marginTop: 2, lineHeight: 1.3 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  barLabel: { width: 118, fontSize: 7.5, paddingRight: 6 },
  barTrack: { flex: 1, height: 6, backgroundColor: TRACK, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  barValue: { width: 66, fontSize: 7.5, textAlign: 'right' },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: 3,
    marginBottom: 2,
    alignItems: 'flex-end',
  },
  th: { fontSize: 6.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase' },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingVertical: 3,
    alignItems: 'center',
  },
  td: { fontSize: 8 },
  bold: { fontWeight: 700 },
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
  box: { borderWidth: 0.5, borderColor: BORDER, borderRadius: 4, padding: 8 },
  tinted: { backgroundColor: BAND, borderColor: BORDER },
  link: { color: INK, fontWeight: 700, textDecoration: 'underline' },
  chip: {
    fontSize: 7.5,
    borderWidth: 0.5,
    borderColor: BORDER,
    backgroundColor: BAND,
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  tag: {
    fontSize: 6.5,
    color: '#ffffff',
    backgroundColor: INK,
    borderRadius: 6,
    paddingVertical: 1.5,
    paddingHorizontal: 5,
  },
  qRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingVertical: 1.5,
  },
  qText: { fontSize: 7.2, lineHeight: 1.2 },
  cellCol: { width: 34, alignItems: 'center' },
  cell: { width: 24, height: 9, borderRadius: 2 },
  legend: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    backgroundColor: BAND,
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footer: {
    position: 'absolute',
    bottom: 22,
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

function Footer({ t }: { t: CardCopy }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{look.footer ?? ''}</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => t.footer(pageNumber, totalPages)}
      />
    </View>
  );
}

/** The card's date, in its language. */
const dateOf = (iso: string, locale: string) =>
  new Date(iso).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

interface PageProps {
  card: ReportCardPayload;
  t: CardCopy;
  font: { fontFamily: string };
}

// ─── Page 1: status ──────────────────────────────────────────────────────────

function StatusPage({ card, t, font }: PageProps) {
  const s = t.status;
  // Every engine's answers, for the questions asked; every other figure
  // counts the headline's (the main engines').
  const { answers: asked } = totals(card);
  const headline = mainTotals(card);
  const { answers, named } = headline;
  const main = mainEngineRows(card);
  const growth = growthEngineRows(card);
  const leader = card.competitors[0];
  const rivals = card.competitors.slice(0, 3);
  const most = Math.max(named, ...rivals.map((c) => c.answers), 1);
  const cited = card.citedSites.slice(0, 5);
  const mostCited = Math.max(...cited.map((site) => site.answers), 1);
  const date = dateOf(card.generatedAt, t.locale);
  const products = productNames(card);
  const start = startingPoint(card);
  const first = quickWins(card, t)[0];
  const missed = topMissed(card);
  const mainNames = engineList(main, t);
  const readers = card.audience === 'readers';

  return (
    <Page size="A4" style={[styles.page, font]}>
      <Header
        eyebrow={s.eyebrow}
        title={s.title(clip(card.companyName, 60))}
        subtitle={s.subtitle(
          clip(card.domain, 60),
          card.country.name,
          t.language(card.language),
          date,
        )}
      />

      <View style={[styles.box, styles.tinted, { marginBottom: 8, padding: 6 }]} wrap={false}>
        <Text style={[styles.small, { color: TEXT }]}>{s.oneTime(date)}</Text>
      </View>

      {products.length > 0 && (
        <View
          style={[styles.section, { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }]}
          wrap={false}
        >
          <Text style={[styles.paragraph, styles.bold, { marginRight: 2 }]}>
            {s.understood(clip(card.domain, 40), readers)}
          </Text>
          {products.map((name) => (
            <Text key={name} style={styles.chip}>
              {name}
            </Text>
          ))}
          <Text style={[styles.small, { marginLeft: 2 }]}>{s.understoodNote}</Text>
        </View>
      )}

      <View style={[styles.section, styles.row]} wrap={false}>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>{s.kpiVisibility}</Text>
          <Text style={styles.kpiValue}>{headline.visibility}%</Text>
          <Text style={styles.kpiSub}>
            {s.kpiVisibilitySub(
              mainNames,
              headline.named,
              headline.answers,
              card.questionCount,
              main.length,
            )}
          </Text>
        </View>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>{s.kpiQuestions}</Text>
          <Text style={styles.kpiValue}>{card.questionCount}</Text>
          <Text style={styles.kpiSub}>
            {s.kpiQuestionsSub(
              card.engines.length,
              asked,
              Math.max(card.questionCount * card.engines.length - asked, 0),
            )}
          </Text>
        </View>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>{s.kpiLeader}</Text>
          <Text style={styles.kpiValueSmall}>
            {leader ? clip(leader.name, 40) : s.kpiLeaderNone}
          </Text>
          <Text style={styles.kpiSub}>
            {leader ? s.kpiLeaderSub(leader.answers, answers) : s.kpiLeaderNoneSub}
          </Text>
        </View>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>{s.kpiCited}</Text>
          <Text style={styles.kpiValue}>{card.ownCitations}</Text>
          <Text style={styles.kpiSub}>{s.kpiCitedSub(answers)}</Text>
        </View>
      </View>

      {start ? (
        <View style={[styles.box, styles.section, { borderColor: INK }]} wrap={false}>
          <Text style={[styles.paragraph, styles.bold]}>{s.startTitle}</Text>
          <Text style={styles.paragraph}>
            {start.cited > 0 ? s.startCited(mainNames, start.cited) : s.startNone(mainNames)}
          </Text>
          {first && (
            <Text style={[styles.paragraph, { marginTop: 3 }]}>
              <Text style={styles.bold}>{s.firstStep} </Text>
              {first.title}
            </Text>
          )}
        </View>
      ) : (
        first && (
          <Text style={[styles.paragraph, styles.section]}>
            <Text style={styles.bold}>{s.firstStep} </Text>
            {first.title}
          </Text>
        )
      )}

      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>{s.byEngine}</Text>
        {main.map((e) => (
          <Bar
            key={e.engine}
            label={engineLabel(e.engine)}
            pct={percent(e.named, e.answers)}
            value={s.engineValue(e.named, e.answers, percent(e.named, e.answers))}
            color={INK}
          />
        ))}
        {growth.length > 0 && (
          <View style={[styles.box, { marginTop: 3, padding: 5, paddingBottom: 1 }]}>
            <Text style={[styles.small, { marginBottom: 3 }]}>{s.growthBand(mainNames)}</Text>
            {growth.map((e) => (
              <Bar
                key={e.engine}
                label={engineLabel(e.engine)}
                pct={percent(e.named, e.answers)}
                value={s.engineValue(e.named, e.answers, percent(e.named, e.answers))}
                color={COMPETITOR}
              />
            ))}
          </View>
        )}
      </View>

      <View style={[styles.section, styles.row]} wrap={false}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{s.whoNamed}</Text>
          {rivals.length === 0 && (
            <Text style={[styles.paragraph, styles.muted]}>{s.noCompetitor}</Text>
          )}
          {[{ name: card.companyName, answers: named, own: true }, ...rivals]
            .sort((a, b) => b.answers - a.answers)
            .map((c) => (
              <Bar
                key={c.name}
                label={'own' in c ? s.you(c.name) : c.name}
                pct={(c.answers / most) * 100}
                value={s.answersCount(c.answers)}
                color={'own' in c ? INK : COMPETITOR}
                strong={'own' in c}
              />
            ))}
          {alsoNamed(card, t).map((line) => (
            <Text key={line} style={[styles.small, { marginTop: 1 }]}>
              {line}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{s.sitesCited}</Text>
          {cited.length === 0 && <Text style={[styles.paragraph, styles.muted]}>{s.noSites}</Text>}
          {cited.map((site) => {
            const kind = site.own
              ? 'own'
              : site.competitor
                ? 'competitor'
                : (kindOf(site) ?? 'other');
            return (
              <Bar
                key={site.domain}
                label={`${clip(site.domain, DOMAIN_MAX)}${s.siteTag[kind] ?? ''}`}
                pct={(site.answers / mostCited) * 100}
                value={s.answersCount(site.answers)}
                color={site.own ? INK : COMPETITOR}
                strong={site.own}
              />
            );
          })}
        </View>
      </View>

      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>{s.missedTitle}</Text>
        {missed.length === 0 ? (
          <Text style={[styles.paragraph, styles.muted]}>{s.missedNone}</Text>
        ) : (
          <>
            <Text style={[styles.small, { marginBottom: 3 }]}>
              {s.missedSub(card.missedCount, card.questionCount)}
            </Text>
            {missed.map((line, i) => (
              <View key={line.text} style={[styles.tr, { paddingVertical: 2.5 }]}>
                <Text style={[styles.qText, { width: 14, color: MUTED }]}>{i + 1}</Text>
                <Text style={[styles.qText, { flex: 1, paddingRight: 6 }]}>{line.text}</Text>
                <Text style={[styles.qText, { width: 150, color: MUTED }]}>
                  {line.instead.length ? s.missedInstead(t.list(line.instead)) : '—'}
                </Text>
              </View>
            ))}
          </>
        )}
      </View>

      <Text style={[styles.small, { marginTop: 'auto' }]}>
        {s.measured(
          card.questionCount,
          readers,
          engineList(card.engines, t),
          t.country(card.country),
          date,
        )}
      </Text>
      <Footer t={t} />
    </Page>
  );
}

// ─── Page 2: the questions ───────────────────────────────────────────────────

/** The engines' short names, for page 2's narrow columns. */
const SHORT_ENGINE: Record<string, string> = {
  'chatgpt-web': 'ChatGPT',
  'copilot-web': 'Copilot',
  'gemini-web': 'Gemini',
  'google-aio': 'AI Overv.',
  'google-aimode': 'AI Mode',
};

/** One cell of the grid: ink where the answer named the company, sand where it didn't. */
function Cell({ mark }: { mark: 'named' | 'missed' | 'none' | undefined }) {
  const style =
    mark === 'named'
      ? { backgroundColor: INK }
      : mark === 'missed'
        ? { backgroundColor: MISSED_CELL }
        : { borderWidth: 0.5, borderColor: BORDER };
  return <View style={[styles.cell, style]} />;
}

function QuestionsPage({ card, t, font }: PageProps) {
  const q = t.questions;
  const groups = questionGroups(card);
  const total = groups.reduce((sum, g) => sum + g.lines.length, 0);
  const summary = questionSummary(card, t);
  const main = mainEngineRows(card).map((e) => e.engine);
  const growth = growthEngineRows(card).map((e) => e.engine);
  const withProducts = groups.some((g) => g.product);
  const withVolume = groups.some((g) => g.lines.some((l) => l.volume !== null));
  const headerCell = (engine: ReportCardEngine) => (
    <View key={engine} style={styles.cellCol}>
      <Text style={[styles.th, { textAlign: 'center' }]}>
        {SHORT_ENGINE[engine] ?? engineLabel(engine)}
      </Text>
    </View>
  );

  return (
    <Page size="A4" style={[styles.page, font]}>
      <Header
        eyebrow={q.eyebrow}
        title={q.title(total)}
        subtitle={q.subtitle(
          clip(card.domain, 60),
          t.country(card.country),
          t.language(card.language),
          withProducts,
        )}
      />
      {summary && (
        <Text style={[styles.paragraph, styles.bold, { marginBottom: 5 }]}>{summary}</Text>
      )}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <Cell mark="named" />
          <Text style={styles.qText}>{q.legendNamed}</Text>
        </View>
        <View style={styles.legendItem}>
          <Cell mark="missed" />
          <Text style={styles.qText}>{q.legendMissed}</Text>
        </View>
        <View style={styles.legendItem}>
          <Cell mark="none" />
          <Text style={styles.qText}>{q.legendNone}</Text>
        </View>
        {growth.length > 0 && <Text style={[styles.qText, { color: MUTED }]}>{q.growthKey}</Text>}
      </View>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: 16 }]}>#</Text>
        <Text style={[styles.th, { flex: 1 }]}>{q.colQuestion}</Text>
        {withVolume && (
          <Text style={[styles.th, { width: 40, textAlign: 'right', paddingRight: 6 }]}>
            {q.colSearches}
          </Text>
        )}
        {main.map(headerCell)}
        {growth.length > 0 && <View style={{ width: 6 }} />}
        {growth.map(headerCell)}
        <Text style={[styles.th, { width: 82, paddingLeft: 4 }]}>{q.colInstead}</Text>
      </View>
      {groups.map((group) => (
        <View key={group.product ?? 'other'}>
          {group.product && (
            <Text style={[styles.qText, styles.bold, { marginTop: 3, marginBottom: 0.5 }]}>
              {group.product}
              <Text style={{ color: MUTED, fontWeight: 400 }}>
                {' '}
                · {q.groupCount(group.lines.length)}
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
                  <Text style={{ color: MUTED }}> ({q.related})</Text>
                ) : null}
              </Text>
              {withVolume && (
                <Text style={[styles.qText, { width: 40, textAlign: 'right', paddingRight: 6 }]}>
                  {line.volume === null ? '–' : count(line.volume, t.locale)}
                </Text>
              )}
              {main.map((engine) => (
                <View key={engine} style={styles.cellCol}>
                  <Cell mark={line.named[engine]} />
                </View>
              ))}
              {growth.length > 0 && <View style={{ width: 6 }} />}
              {growth.map((engine) => (
                <View key={engine} style={[styles.cellCol, { opacity: 0.6 }]}>
                  <Cell mark={line.named[engine]} />
                </View>
              ))}
              <Text style={[styles.qText, { width: 82, paddingLeft: 4, color: MUTED }]}>
                {line.instead ?? '—'}
              </Text>
            </View>
          ))}
        </View>
      ))}
      {withVolume && <Text style={[styles.small, { marginTop: 5 }]}>{q.searchesNote}</Text>}
      <Footer t={t} />
    </Page>
  );
}

// ─── Page 3: the plan ────────────────────────────────────────────────────────

function PlanPage({ card, t, font }: PageProps) {
  const p = t.plan;
  const wins = quickWins(card, t);
  const { groups, leftOut } = targetGroups(card);
  const prompt = examplePrompt(card);

  return (
    <Page size="A4" style={[styles.page, font]}>
      <Header
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={p.subtitle(clip(card.companyName, 60))}
      />

      {wins.map((win, i) => (
        <View key={win.title} style={[styles.box, { marginBottom: 7, padding: 0 }]} wrap={false}>
          <View style={{ flexDirection: 'row', gap: 8, padding: 8, paddingBottom: 6 }}>
            <Text style={styles.number}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.paragraph, styles.bold]}>{win.title}</Text>
              <Text style={[styles.paragraph, styles.muted]}>{win.detail}</Text>
            </View>
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: BAND,
              paddingVertical: 5,
              paddingHorizontal: 8,
              borderBottomLeftRadius: 4,
              borderBottomRightRadius: 4,
            }}
          >
            <Text style={[styles.th, { width: 52 }]}>{p.weekOne}</Text>
            <Text style={[styles.paragraph, { flex: 1 }]}>{win.week}</Text>
            <Text style={styles.tag}>
              {p.inAnsvisor} · {p.feature[win.feature]}
            </Text>
          </View>
        </View>
      ))}

      <View style={[styles.section, { marginTop: 4 }]} wrap={false}>
        <Text style={styles.sectionTitle}>{p.targetsTitle}</Text>
        <Text style={[styles.small, { marginBottom: 4 }]}>{p.targetsSub}</Text>
        <View style={[styles.row, { gap: 6 }]}>
          {groups.map((group) => (
            <View key={group.kind} style={[styles.box, { flex: 1, padding: 6 }]}>
              <Text style={[styles.th, { marginBottom: 3 }]}>{p.targetKind[group.kind]}</Text>
              {group.sites.length === 0 ? (
                <Text style={styles.small}>{p.targetsNone}</Text>
              ) : (
                group.sites.map((site) => (
                  <Text key={site.domain} style={[styles.qText, { marginBottom: 1 }]}>
                    {site.domain}
                    <Text style={{ color: MUTED }}> · {site.answers}</Text>
                  </Text>
                ))
              )}
            </View>
          ))}
        </View>
        {leftOut.length > 0 && (
          <Text style={[styles.small, { marginTop: 3 }]}>
            {p.targetsLeftOut(t.list(leftOut.slice(0, 4)))}
          </Text>
        )}
      </View>

      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>{p.howTitle}</Text>
        <View style={styles.row}>
          <View style={[styles.box, { flex: 1, borderColor: INK }]}>
            <Text style={[styles.paragraph, styles.bold, { marginBottom: 2 }]}>
              {p.approveTitle}
            </Text>
            <Text style={[styles.paragraph, styles.muted]}>{p.approveBody}</Text>
          </View>
          <View style={[styles.box, { flex: 1, borderColor: INK }]}>
            <Text style={[styles.paragraph, styles.bold, { marginBottom: 2 }]}>{p.autoTitle}</Text>
            <Text style={[styles.paragraph, styles.muted]}>{p.autoBody}</Text>
          </View>
        </View>
      </View>

      {prompt && (
        <View style={[styles.box, styles.tinted, { marginTop: 'auto' }]} wrap={false}>
          <Text style={styles.small}>{p.examplePrompt}</Text>
          <Text style={[styles.paragraph, styles.bold, { marginTop: 2 }]}>“{prompt}”</Text>
        </View>
      )}
      <Footer t={t} />
    </Page>
  );
}

// ─── Page 4: value and plan ──────────────────────────────────────────────────

function ValuePage({ card, t, font }: PageProps) {
  const v = t.value;
  const ads = adsVerdict(card);
  const values = valueRows(card);
  const demand = questionDemand(card);
  const compare = buyVsEarn(card);
  const revenue = revenueRows(card);
  const rate = conversionRange(card.siteType);
  const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
  const usd = (amount: number) => money(amount, 'USD', t.locale);
  const country = t.country(card.country);
  const growth = growthEngineRows(card);
  // Starter's own engines, whatever the card asked (an older card asked others).
  const starterNames = t.list(STARTER_ENGINES.map(engineLabel));
  const prompts = planPrompts('starter');

  return (
    <Page size="A4" style={[styles.page, font]}>
      <Header eyebrow={v.eyebrow} title={v.title} subtitle={v.subtitle} />

      <View style={styles.section} wrap={false}>
        {demand && (
          <Text style={styles.paragraph}>
            {v.demand(count(demand.searches, t.locale), country, demand.keywords)}
          </Text>
        )}
        {ads.kind === 'none' && (
          <Text style={[styles.paragraph, styles.muted]}>{v.noAds(country)}</Text>
        )}
        {ads.kind === 'odd' && (
          <Text style={[styles.paragraph, styles.muted]}>
            {v.oddAds(cents(ads.usd, 'USD', t.locale), ads.keywords)}
          </Text>
        )}
        {values && ads.kind === 'ok' && (
          <>
            <Text style={[styles.paragraph, styles.muted, { marginBottom: 4 }]}>
              {v.cpcLine(cents(ads.usd, 'USD', t.locale), ads.keywords, card.questionCount)}
            </Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 1.3 }]}>{v.colShare}</Text>
              <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>{v.colVisits}</Text>
              <Text style={[styles.th, { flex: 1.3, textAlign: 'right' }]}>{v.colAds}</Text>
              <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>{v.colYear}</Text>
            </View>
            {values.map((row) => (
              <View key={row.visits} style={styles.tr}>
                <Text style={[styles.td, { flex: 1.3 }]}>
                  {row.share === null ? '' : v.share(Math.round(row.share * 100))}
                </Text>
                <Text style={[styles.td, { flex: 1, textAlign: 'right' }]}>
                  {count(row.visits, t.locale)}
                </Text>
                <Text style={[styles.td, styles.bold, { flex: 1.3, textAlign: 'right' }]}>
                  {usd(row.monthly)}
                </Text>
                <Text style={[styles.td, { flex: 1, textAlign: 'right' }]}>{usd(row.yearly)}</Text>
              </View>
            ))}
            <Text style={[styles.small, { marginTop: 3 }]}>{v.tableNote}</Text>
          </>
        )}
      </View>

      {compare && (
        <View style={styles.section} wrap={false}>
          {compare.cheap ? (
            <View style={[styles.box, styles.tinted]}>
              <Text style={styles.paragraph}>
                {v.cheap(usd(compare.adsMonthly), 'Starter', usd(compare.starterMonthly))}
              </Text>
            </View>
          ) : (
            <View style={styles.row}>
              <View style={[styles.box, { flex: 1 }]}>
                <Text style={styles.eyebrow}>{v.buying}</Text>
                <Text style={[styles.paragraph, { marginTop: 2 }]}>
                  {v.buyingBody(
                    count(compare.visits, t.locale),
                    usd(compare.adsMonthly),
                    usd(compare.adsYearly),
                  )}
                </Text>
              </View>
              <View style={[styles.box, styles.tinted, { flex: 1 }]}>
                <Text style={styles.eyebrow}>{v.earning}</Text>
                <Text style={[styles.paragraph, { marginTop: 2 }]}>
                  {v.earningBody('Starter', usd(compare.starterMonthly))}
                </Text>
              </View>
            </View>
          )}
          <Text style={[styles.small, { marginTop: 3 }]}>{v.slow}</Text>
        </View>
      )}

      {revenue && card.dealValue && (
        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>{v.revenueTitle}</Text>
          <Text style={[styles.paragraph, styles.muted, { marginBottom: 2 }]}>
            {v.revenue(
              rate.kind,
              money(card.dealValue.amount, card.dealValue.currency, t.locale),
              pct(rate.low),
              pct(rate.high),
            )}
          </Text>
          {revenue.map((row) => (
            <Text key={row.visits} style={styles.paragraph}>
              {v.revenueRow(
                count(row.visits, t.locale),
                money(row.low, card.dealValue?.currency, t.locale),
                money(row.high, card.dealValue?.currency, t.locale),
              )}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>{v.planTitle}</Text>
        <View style={[styles.box, { borderColor: INK }]}>
          <Text style={[styles.paragraph, styles.bold]}>
            Ansvisor Starter · {v.perMonth(usd(planMonthly('starter')))}
            <Text style={[styles.muted, { fontWeight: 400 }]}>
              {' '}
              · {v.yearly(usd(planYearly('starter')))}
            </Text>
          </Text>
          <Text style={[styles.paragraph, styles.muted]}>
            {v.starterMatch(starterNames, growth.length > 0)}
          </Text>
          <Text style={[styles.paragraph, styles.muted]}>
            {v.starterLimits(prompts, planBrands('starter'))}
          </Text>
        </View>
        <Text style={[styles.small, { marginTop: 3 }]}>
          {v.growthLine(
            growth.length ? engineList(growth, t) : v.googleEngines,
            usd(planMonthly('growth')),
            usd(planYearly('growth')),
            planPrompts('growth'),
            planBrands('growth'),
          )}
        </Text>
      </View>

      <View style={[styles.box, styles.tinted, { marginTop: 'auto' }]} wrap={false}>
        <Text style={[styles.sectionTitle, { marginBottom: 3 }]}>{v.ctaTitle}</Text>
        <Text style={[styles.paragraph, { marginBottom: 4 }]}>
          {v.ctaBody(prompts, starterNames, card.questionCount)}
        </Text>
        {v
          .steps(clip(card.domain, 60), card.questionCount, t.country(card.country))
          .map((line, i) => (
            <Text key={line} style={styles.paragraph}>
              {i + 1}. {line}
            </Text>
          ))}
        <Link
          src={REPORT_CARD_SIGN_UP_URL}
          style={[styles.paragraph, styles.link, { marginTop: 5 }]}
        >
          {v.ctaLink}
        </Link>
        <Text style={[styles.small, { marginTop: 5 }]}>{v.scenarios}</Text>
      </View>
      <Footer t={t} />
    </Page>
  );
}

export function ReportCardPdfDocument({
  card,
  family = FAMILY,
}: {
  card: ReportCardPayload;
  /** The font family Inter was registered under for this card. */
  family?: string;
}) {
  const t = cardCopy(card);
  const font = { fontFamily: family };
  return (
    <Document
      title={t.document(clip(card.companyName, 60))}
      author={look.author}
      creator={look.author}
    >
      <StatusPage card={card} t={t} font={font} />
      {(card.questionRows?.length ?? 0) > 0 && <QuestionsPage card={card} t={t} font={font} />}
      <PlanPage card={card} t={t} font={font} />
      <ValuePage card={card} t={t} font={font} />
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
    unregisterFonts(family);
  }
}
