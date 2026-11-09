import type { CardCopy, TargetKind } from './copy';
import { countryIn, languageIn } from './copy-names';

/**
 * The report card in Turkish, for Türkiye (owner decision 2026-11-04: the
 * whole card in the target language). Sentences never put a Turkish case
 * ending on a brand, a site or a question, which would need vowel harmony
 * for each name: "{marka} markası", "{site} sitesinde". Ansvisor's own
 * product, feature and button names stay in English, as the app shows them
 * (owner decision 2026-11-08), a suffix after an apostrophe as the English
 * is said: "Action Center’ı", "Agent Center’da". The country and the
 * language are named in Turkish, as a card for another country written in
 * Turkish needs (owner decision 2026-11-09): "Almanya", "Almanca".
 */

/** "A", "A ve B", "A, B ve C". */
export function listTr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ve ${items[items.length - 1]}`;
}

/**
 * The answers a base falls short of its questions × engines by: the
 * product is printed only when every question was answered.
 */
const noAnswer = (missing: number) =>
  missing === 1 ? '1 soruya bir motordan yanıt gelmedi' : `${missing} kez yanıt gelmedi`;

interface TargetStep {
  title: (company: string, domain: string) => string;
  detail: (cited: number, answers: number) => string;
  week: (company: string, domain: string) => string;
}

export const tr: CardCopy = {
  locale: 'tr-TR',
  list: listTr,
  countryName: (country) => countryIn('tr', country),
  country: (country) => countryIn('tr', country),
  language: (english) => languageIn('tr', english),
  document: (company) => `Yapay zekâ görünürlük karnesi: ${company}`,
  footer: (page, pages) => `${page} / ${pages}`,
  brand: 'Ansvisor ile hazırlandı · www.ansvisor.com',
  engines: {
    count: (n) => `${n} yapay zekâ motoru`,
    the: (n) => `${n} motor`,
  },

  // ─── Sayfa 1 ───────────────────────────────────────────────────────────────
  status: {
    eyebrow: 'Ücretsiz yapay zekâ görünürlük karnesi',
    trial: 'Ücretsiz deneyin',
    title: (company) => `${company}, yapay zekâ yanıtlarında ne kadar görünür?`,
    subtitle: (domain, country, language, date) => `${domain} · ${country}, ${language} · ${date}`,
    oneTime: (date) =>
      `Tek seferlik bir ölçüm: her soruyu ${date} tarihinde bir kez sorduk. Yapay zekâ yanıtları her gün değişir; Ansvisor bu soruları her gün sorar.`,
    understood: (domain, readers) =>
      readers
        ? `${domain} sitesini şöyle anladık: yayın konuları`
        : `${domain} sitesini şöyle anladık: sattıklarınız`,
    understoodNote: '2. sayfadaki sorular bunlarla ilgili.',
    kpiVisibility: 'Yapay zekâ görünürlüğü',
    kpiVisibilitySub: (engines, named, answers, questions, engineCount) => {
      const missing = questions * engineCount - answers;
      if (missing === 0) {
        return `${answers} yanıtın ${named} tanesinde adınız geçiyor: ${questions} soru × ${engineCount} motor (${engines})`;
      }
      return `${engines} motorlarının ${answers} yanıtından ${named} tanesinde adınız geçiyor${missing > 0 ? ` (${noAnswer(missing)})` : ''}`;
    },
    kpiQuestions: 'Sorulan soru',
    kpiQuestionsSub: (engines, answers, unanswered) =>
      `${engines} yapay zekâ motorunda: ${answers} yanıt${unanswered > 0 ? ` (${unanswered} kez yanıt gelmedi)` : ''}`,
    kpiLeader: 'Öne çıkan rakip',
    kpiLeaderNone: 'Rakip yok',
    kpiLeaderSub: (answers, total) => `aynı ${total} yanıtın ${answers} tanesinde geçiyor`,
    kpiLeaderNoneSub: 'bu yanıtlarda',
    kpiCited: 'Sitenize kaynak gösterilen',
    kpiCitedSub: (total) => `aynı ${total} yanıttan sayfanızı kaynak gösterenler`,
    startTitle: 'Başlangıç noktanız',
    startCited: (engines, cited) =>
      `${engines} adınızı henüz anmıyor; ama yapay zekâ sitenizi zaten okuyor: ${cited} yanıtta sayfalarınızı kaynak gösterdi, adınızı söylemedi. Başlanacak yer burası.`,
    startNone: (engines) =>
      `${engines} adınızı henüz anmıyor. Yapay zekâ yanıtlarındaki her marka buradan başladı: 3. sayfadaki adımlar ilk haftanız.`,
    firstStep: 'İlk adımınız:',
    byEngine: 'Motorlara göre görünürlük',
    engineValue: (named, answers, pct) => `${answers} yanıtta ${named} · %${pct}`,
    growthBand: (starter) =>
      `Ansvisor Growth’ta: Google’ın yapay zekâ motorları, bunları da ölçtük. Starter ${starter} motorlarını izler; Growth bunları ekler.`,
    whoNamed: 'Yapay zekâ kimi öneriyor',
    noCompetitor: 'Hiçbir rakip anılmadı.',
    you: (name) => `${name} (siz)`,
    answersCount: (n) => `${n} yanıt`,
    sitesCited: 'Yapay zekânın en çok kaynak gösterdiği siteler',
    noSites: 'Hiçbir site kaynak gösterilmedi.',
    siteTag: { own: ' (siz)', competitor: ' (rakip)', marketplace: ' (pazaryeri)' },
    alsoMarketplaces: (names) => `Anılan pazaryerleri: ${names}`,
    alsoOthers: (names) => `Anılan diğer işletmeler: ${names}`,
    missedTitle: 'Yapay zekânın sizi değil başkalarını önerdiği sorular',
    missedSub: (missed, total) =>
      `${total} sorunun ${missed} tanesinde hiçbir yanıt adınızı anmadı. Rakiplerinizin en çok kazandığı beşi:`,
    missedInstead: (names) => `Önerilen: ${names}`,
    missedNone: 'Hiçbir yanıt başka bir markayı anmadı.',
    measured: (questions, readers, engines, country, date) =>
      `Nasıl ölçtük: bir ${readers ? 'okurun' : 'alıcının'} sorabileceği ${questions} soruyu ${date} tarihinde ${country} konumundan ${engines} motorlarında birer kez sorduk. Görünürlük, adınızı ya da sitenizi anan yanıtların payıdır; rakipler ve siteler aynı yanıtlar üzerinden sayıldı. Soruların tamamı 2. sayfada.`,
  },

  // ─── Bulgular (sayfa 1 ve 3) ───────────────────────────────────────────────
  wins: {
    question: {
      title: (question) => `Sitenizde şu soruyu yanıtlayın: “${question}”`,
      detailNames: (names, company) =>
        `Yapay zekâ bu soruda ${names} markalarını öneriyor, ${company} markasını değil.`,
      detailNone: (company) => `Bu sorunun yanıtlarının hiçbiri ${company} markasını anmıyor.`,
      week: (page) =>
        page
          ? `Bu soruyu doğrudan yanıtlayan bir sayfa yazın: başlığı soru, ilk paragrafı yanıt olsun; ${page} sayfasından bağlantı verin.`
          : 'Bu soruyu doğrudan yanıtlayan bir sayfa yazın: başlığı soru, ilk paragrafı yanıt olsun.',
    },
    target: {
      guide: {
        title: (company, domain) => `${domain} sitesinde ${company} markasını listeletin`,
        detail: (cited, answers) =>
          `Pazarınızla ilgili ${answers} yanıtın ${cited} tanesinde kaynak gösterilen bir rehber. Oradaki bir listeleme ya da inceleme, yapay zekâya adınızı anan bir kaynak verir.`,
        week: (_company, domain) =>
          `${domain} sitesinde sizin gibi işletmeleri karşılaştıran sayfayı bulun; eklenmek ya da incelenmek için başvurun.`,
      },
      publication: {
        title: (_company, domain) => `${domain} için bir haber ya da uzman görüşü önerin`,
        detail: (cited, answers) =>
          `Pazarınızla ilgili ${answers} yanıtın ${cited} tanesinde kaynak gösterilen bir yayın. Oradaki bir yazı ya da alıntı, yapay zekânın güvendiği bir kaynaktır.`,
        week: (_company, domain) =>
          `${domain} editörlerine kısa bir öneri gönderin: yalnızca sizde olan bir veri ya da hikâye.`,
      },
      official: {
        title: (company, domain) => `${domain} sitesinde ${company} kaydını kontrol edin`,
        detail: (cited, answers) =>
          `${answers} yanıtın ${cited} tanesinde kaynak gösterilen resmî bir kaynak. Oradaki kayıtlarınız, üyelikleriniz ve belgeleriniz yapay zekânın tekrarladığı bilgilerdir.`,
        week: (_company, domain) =>
          `${domain} sitesinde kaydınızı bulun; eksikleri tamamlayın, yanlışları düzeltin.`,
      },
      community: {
        title: (_company, domain) => `${domain} sitesinde pazarınızla ilgili soruları yanıtlayın`,
        detail: (cited, answers) =>
          `${answers} yanıtın ${cited} tanesinde kaynak gösterilen bir topluluk. Ekibinizden gelen açık ve yararlı yanıtlar alıntılanır.`,
        week: (_company, domain) =>
          `${domain} sitesinde pazarınızla ilgili iki açık soruyu, ekibinizden olduğunuzu belirterek yanıtlayın.`,
      },
      reviews: {
        title: (company, domain) =>
          `${domain} sitesinde müşterilerin ${company} hakkında yazdıklarını okuyun ve yanıtlayın`,
        detail: (cited, answers) =>
          `${answers} yanıtın ${cited} tanesinde kaynak gösterilen bir yorum sitesi. Müşterilerin orada yazdıkları ve sizin yanıtlarınız, yapay zekânın sizin hakkınızda okuduklarıdır.`,
        week: (_company, domain) =>
          `${domain} sitesindeki son yorum ve şikâyetleri yanıtlayın, profilinizi tamamlayın.`,
      },
      other: {
        title: (company, domain) => `${domain} sitesinde ${company} markasının anılmasını sağlayın`,
        detail: (cited, answers) =>
          `Pazarınızla ilgili ${answers} yanıtın ${cited} tanesinde kaynak gösteriliyor. Oradaki bir anılma ya da listeleme sizi öne çıkarır.`,
        week: (_company, domain) =>
          `${domain} sitesinde işletmelerin nasıl yer aldığını öğrenin ve başvurun.`,
      },
    } as Record<TargetKind | 'other', TargetStep>,
    ownName: {
      title: 'Yapay zekânın zaten okuduğu sayfalarda adınızı söyleyin',
      detail: (cited, company) =>
        `Yapay zekâ ${cited} yanıtta sayfalarınızı kaynak gösterdi ama ${company} markasını anmadı.`,
      week: 'Yapay zekânın kaynak gösterdiği sayfalarda kim olduğunuzu söyleyin: marka adınız başlıkta, ilk cümlede ve ara başlıklarda geçsin.',
    },
    ownPages: {
      title: 'Sayfalarınızı kaynak gösterilmesi kolay hale getirin',
      detail: (cited, answers) =>
        `Siteniz ${answers} yanıtın ${cited} tanesinde kaynak gösteriliyor.`,
      week: 'Yapay zekânın kaynak göstermesini istediğiniz üç sayfayı seçin: yanıtı ilk paragrafa koyun, bu karnedeki sorularla kısa bir SSS ekleyin.',
    },
    gap: {
      title: (rival) => `${rival} ile aradaki farkı kapatın`,
      detail: (rival, rivalNamed, company, named) =>
        `${rival} ${rivalNamed} yanıtta, ${company} ${named} yanıtta anılıyor.`,
      week: (rival) =>
        `${rival} markasının kazandığı bir sorudaki sayfasını açın; onda olup sizde olmayanları listeleyin.`,
    },
    weakest: {
      title: (engine) => `${engine} pazarınız hakkında ne diyor, bakın`,
      detail: (named, answers, engines) =>
        `${answers} yanıtın ${named} tanesinde adınız geçiyor: ${engines} içinde en az.`,
      week: (engine) =>
        `Bu karnedeki sorulardan üçünü ${engine} motoruna kendiniz sorun; kaynak gösterdiği siteleri not edin.`,
    },
    keep: {
      title: (company) => `${company} yerini korusun`,
      detail: (named, answers) =>
        `Yapay zekâ ${answers} yanıtın ${named} tanesinde adınızı anıyor, her motorda benzer şekilde.`,
      week: 'Bu karnedeki soruları her gün izleyin: motorlar güncellendikçe yanıtlar değişir.',
    },
  },

  // ─── Sayfa 2 ───────────────────────────────────────────────────────────────
  questions: {
    eyebrow: 'Neler sorduk',
    title: (n) => `${n} soru ve her motorun yanıtı`,
    subtitle: (domain, country, language, products) =>
      products
        ? `${domain} sitesindeki ana ürünlerden yazıldı; sattıklarınızla ne kadar örtüştüğüne ve ne sıklıkla arandığına göre seçildi; ${country} konumundan, ${language} soruldu.`
        : `${country} konumundan, ${language} soruldu.`,
    summaryNone: (company, answers, total, engines, engineCount) => {
      const missing = total * engineCount - answers;
      const base =
        missing === 0
          ? `${total} soru × ${engineCount} motor`
          : missing > 0
            ? noAnswer(missing)
            : null;
      return `${company} markası ${total} sorunun hiçbirinde anılmadı: ${engines} motorlarından ${answers} yanıt${base ? ` (${base})` : ''}.`;
    },
    summary: (named, answers, questions, total, engines) =>
      `${total} sorunun ${questions} tanesinde adınız geçti: ${engines} motorlarının ${answers} yanıtından ${named} tanesinde.`,
    legendNamed: 'Adınızı andı',
    legendMissed: 'Yanıtladı, adınızı anmadı',
    legendNone: 'Yanıt yok',
    colQuestion: 'Soru',
    colSearches: 'Aylık arama',
    colInstead: 'Önerilen',
    // B: bin, as Google Ads writes it in Turkish; a no-break space keeps "1 B" whole.
    ranges: ['10–100', '100–1\u00a0B', '1\u00a0B–10\u00a0B', '10\u00a0B–100\u00a0B', '100\u00a0B+'],
    low: 'Düşük',
    searchesNote: (low) =>
      `Aylık arama: sorunun anahtar kelimesinin ülkenizde aylık Google arama sayısı, Google’ın verdiği aralık olarak. ${low ? 'Düşük: Google’ın sayı vermeyeceği kadar az arama; insanların' : 'İnsanların'} yapay zekâya sorduğu sorular Google aramalarından daha uzundur, bu yüzden bir anahtar kelimenin sayısı bu soruları olduğundan az gösterir.`,
    groupCount: (n) => `${n} soru`,
    related: 'alıcılarınızın başka bir ihtiyacı',
    growthKey: 'Açık sütunlar: Google motorları, Growth’ta',
  },

  // ─── Sayfa 3 ───────────────────────────────────────────────────────────────
  plan: {
    eyebrow: 'Planınız',
    title: 'Üç bulgu ve ilk haftada yapacaklarınız',
    subtitle: (company) =>
      `${company} sonuçlarından sabit kurallarla seçildi: karnenin bulduğu, ilk yapılacak iş ve Ansvisor’ın yardım ettiği yer.`,
    finding: 'Bulgu',
    weekOne: 'İlk hafta',
    inAnsvisor: 'Ansvisor’da',
    feature: {
      contentEditor: 'Content Editor',
      citations: 'Citations',
      siteAudit: 'Site Audit',
      competitors: 'Competitors',
      brandVisibility: 'Visibility',
    },
    targetsTitle: 'Yapay zekâ nereye bakıyor: yer alabileceğiniz siteler',
    targetsSub: 'Yanıtlarınızda kaynak gösterilen siteler, orada ne yapabileceğinize göre.',
    targetKind: {
      guide: 'Rehberler ve karşılaştırmalar',
      publication: 'Yayınlar',
      official: 'Resmî kaynaklar',
      community: 'Topluluklar',
      reviews: 'Yorum siteleri',
      other: 'Kaynak gösterilen siteler',
    },
    targetsNone: 'Yok',
    targetsLeftOut: (names) =>
      `Dışarıda bırakılanlar: ${names}. Bir rakibin sitesi ya da bir pazaryeri yer almanız gereken bir yer değil.`,
    howTitle: 'İş nasıl yürür',
    approveTitle: 'Her adımı siz onaylarsınız',
    approveBody:
      'Ajanlar “Ask me first” ya da “Auto, ask before changes” modunda başlar: bir şeyi değiştirecek çalışma “Needs you” der ve onayınızı bekler. Hiçbir şey kendiliğinden açılmaz; her değişiklik Activity log’da, Undo ile geri alınabilir. Tüm planlarda.',
    autoTitle: 'Ya da ajanlar kendi başına yayınlasın',
    autoBody:
      'Full auto modunda, bir Admin’in açtığı iki ayarla, seçtiğiniz ajanlar sayfaları tıklamanız olmadan CMS’inize gönderir ya da yayınlar: günde 1 ile 20 arası. Quality ya da marka bilgileri kontrolünden geçmeyen sayfa sizi bekler. Growth’ta.',
    examplePrompt: 'Ansvisor’ın sizin için her gün izleyeceği bir soru:',
  },

  // ─── Sayfa 4 ───────────────────────────────────────────────────────────────
  value: {
    eyebrow: 'Değeri',
    title: 'Yapay zekâ ziyaretlerinin değeri ve bu karne için planlar',
    subtitle:
      'Yapay zekâ ziyaretleri, aynı tıklamaların Google Ads’teki fiyatıyla; iki plan yan yana; ve Ansvisor’ın nasıl yardım ettiği.',
    demand: (searches, country, keywords) =>
      `Sorularınızın anahtar kelimeleri ${country} içinde ayda yaklaşık ${searches} kez Google’da aranıyor (hacmi olan ${keywords} kelime).`,
    cpcLine: (cpc, keywords, total) =>
      `Bu kelimelerin Google Ads’teki tıklama başı ortanca maliyeti: ${cpc} (${total} kelimenin ${keywords} tanesinde var).`,
    colShare: 'Yapay zekâ size gönderse',
    colVisits: 'Aylık yapay zekâ ziyareti',
    colAds: 'Aynı tıklamalar Ads’te, aylık',
    colYear: 'Yıllık',
    share: (pct) => `bu aramaların %${pct} kadarı`,
    buying: 'Satın almak',
    buyingBody: (visits, ads, year) =>
      `Ayda ${visits} ziyaret, Google Ads’te her ay yaklaşık ${ads}: yılda ${year}, her ay yeniden satın alınır.`,
    earning: 'Kazanmak',
    earningBody: (plan, price) =>
      `Ansvisor ${plan} ayda ${price}. Yapay zekânın kaynak gösterdiği sayfalar, kaynak gösterildikleri sürece ziyaret getirmeye devam eder.`,
    cheap: (ads, plan, price) =>
      `Pazarınızda tıklamalar ucuz: bu ziyaretler Ads’te ayda yaklaşık ${ads} tutar, ${price} olan ${plan} planından az. Reklamın satın alamadığı şey, alıcılarınız sorduğunda yapay zekânın önerdiği marka olmaktır.`,
    slow: 'Yapay zekâ ziyaretleri aylar içinde birikir: ilk ay kurulum ve ilk sayfalarla geçer, henüz ziyaret değil.',
    noAds: (country) =>
      `${country} için sorularınızda yeterli reklam verisi yok: bu karnede ziyaret fiyatlanmadı.`,
    oddAds: (cpc, keywords) =>
      `Anahtar kelimeleriniz için bulunan reklam fiyatları hatalı görünüyor (${keywords} kelimeden ${cpc} ortanca): bu karnede ziyaret fiyatlanmadı.`,
    tableNote:
      'Senaryodur, tahmin değil: yapay zekâ yanıtları bu ziyaretleri size gönderseydi reklamda ne tutacağı.',
    revenueTitle: 'Bir gelir senaryosu',
    revenue: (kind, value, low, high) =>
      `Ortalama ${kind === 'order' ? 'sipariş' : 'anlaşma'} değeriniz: ${value}. Varsayım: yapay zekâ ziyaretlerinin ${low} ile ${high} arası ${kind === 'order' ? 'siparişe' : 'anlaşmaya'} dönüşür, diğer ziyaretlerden daha iyi değil.`,
    revenueRow: (visits, low, high) => `Ayda ${visits} yapay zekâ ziyareti: ayda ${low}–${high}`,
    scenarios:
      'Senaryodur; tahmin ya da garanti değildir. Ansvisor’daki AI Traffic, kurulduktan sonra gerçek yapay zekâ ziyaretlerinizi ölçer.',
    planTitle: 'Bu karne için planlar',
    planName: (plan) => `Ansvisor ${plan}`,
    starterTag: 'Bu karneye uyan',
    growthTag: 'Google motorlarını ekler',
    perMonth: (price) => `aylık ${price}`,
    yearly: (price) => `ya da yıllık ödemeyle ${price} (%20 indirim)`,
    starterMatch: (engines, headed) =>
      headed
        ? `${engines} motorlarını her gün izler: bu karnenin görünürlüğü bu motorlarla sayıldı.`
        : `${engines} motorlarını her gün izler.`,
    growthAdds: (engines, banded) =>
      banded
        ? `${engines} motorlarını da her gün izler: 1. sayfadaki Growth bandı.`
        : `${engines} motorlarını da her gün izler.`,
    googleEngines: 'Google AI Overviews ve Google AI Mode',
    planLimits: (prompts, brands) => `Her gün ${prompts} soru, ${brands} marka.`,
    aiIncluded: 'Yapay zekâ kullanımı dahil.',
    aiMore: (times) =>
      `${times} kat yapay zekâ kullanımı: her ay daha çok içerik fırsatı ve taslak, daha çok ajan çalışması ve Action Center önerisi.`,
    siteAudits: (pages) => `Site Audit: ayda ${pages} sayfa.`,
    starterAgents: 'Chat ve her değişiklikten önce soran ajanlarıyla Agent Center.',
    growthAgents: 'Full auto: seçtiğiniz ajanlar kendi başına yayınlar.',
    mcpRead: 'MCP: Ansvisor verilerinizi yapay zekâ araçlarından okuyun.',
    mcpReadWrite: 'MCP: Ansvisor verilerinizi yapay zekâ araçlarından okuyun ve yazın.',
    workTitle: 'Ansvisor işi sizinle birlikte yapar',
    work: [
      {
        title: 'Chat',
        body: 'Kendi Ansvisor verilerinizden yanıt verir, bu karnenin ilk hafta işlerini hazırlar ve eklediğiniz dosyaları okur.',
      },
      {
        title: 'Agent Center',
        body: 'Kullanıma hazır ajanlar ve 700’den fazla skill: rutin yapay zekâ görünürlüğü işlerini bir takvime göre ya da bir şey değiştiğinde yürütür.',
      },
      {
        title: 'MCP',
        body: 'Ansvisor verilerinizi Claude, ChatGPT, Cursor ve diğer yapay zekâ araçlarından kullanın.',
      },
    ],
    ctaTitle: 'Kendi sorularınızı ölçün',
    ctaBody: (prompts, engines, questions) =>
      `Ücretsiz denemeyi başlatın: Starter ${engines} motorlarında her gün ${prompts} soru izler; bu karnenin ${questions} sorusu ve kendi sorularınızdan ${Math.max(prompts - questions, 0)} tanesi sığar.`,
    steps: (domain, questions, country) => [
      `${domain} sitesini markanız olarak ekleyin: kurulum sihirbazı genellikle birkaç dakika sürer.`,
      `Bu karnenin ${questions} sorusunu ${country} için izlemeye alın, kendi sorularınızı ekleyin.`,
      'İlk çalışmadan sonra Action Center’ı açın: sıradaki işler, öncelik sırasıyla.',
    ],
    button: 'Ücretsiz denemeyi başlatın',
  },
};
