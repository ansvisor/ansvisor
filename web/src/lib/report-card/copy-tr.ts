import type { CardCopy, TargetKind } from './copy';

/**
 * The report card in Turkish, for Türkiye (owner decision 2026-11-04: the
 * whole card in the target language). Sentences never put a Turkish case
 * ending on a brand, a site or a question, which would need vowel harmony
 * for each name: "{marka} markası", "{site} sitesinde".
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
  country: (country) => country.name,
  language: (english) =>
    ({ Turkish: 'Türkçe', English: 'İngilizce', German: 'Almanca' })[english] ?? english,
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
    colSearches: 'Arama',
    colInstead: 'Önerilen',
    searchesNote: 'Arama: sorunun anahtar kelimesinin ülkenizde aylık Google arama sayısı.',
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
      contentEditor: 'İçerik Editörü',
      citations: 'Kaynaklar',
      siteAudit: 'Site Denetimi',
      competitors: 'Rakipler',
      brandVisibility: 'Görünürlük',
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
      'Ajanlar “Önce bana sor” ya da “Otomatik, değişiklikten önce sor” modunda başlar: bir şeyi değiştirecek çalışma “Sizi bekliyor” der ve onayınızı bekler. Hiçbir şey kendiliğinden açılmaz; her değişiklik Etkinlik kaydında, geri alınabilir. Tüm planlarda.',
    autoTitle: 'Ya da ajanlar kendi başına yayınlasın',
    autoBody:
      'Tam otomatik modda, bir yöneticinin açtığı iki ayarla, seçtiğiniz ajanlar sayfaları tıklamanız olmadan CMS’inize gönderir ya da yayınlar: günde 1 ile 20 arası. Kalite ya da marka bilgileri kontrolünden geçmeyen sayfa sizi bekler. Growth’ta.',
    examplePrompt: 'Ansvisor’ın sizin için her gün izleyeceği bir soru:',
  },

  // ─── Sayfa 4 ───────────────────────────────────────────────────────────────
  value: {
    eyebrow: 'Değeri',
    title: 'Yapay zekâ ziyaretlerinin değeri ve bu karneye uyan plan',
    subtitle:
      'Yapay zekâ ziyaretleri, aynı tıklamaların Google Ads’teki fiyatıyla; ve bu karnenin ölçtüğü plan.',
    demand: (searches, country, keywords) =>
      `Sorularınızın anahtar kelimeleri ${country} içinde ayda ${searches} kez Google’da aranıyor (hacmi olan ${keywords} kelime).`,
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
      'Senaryodur; tahmin ya da garanti değildir. Ansvisor’daki Yapay Zekâ Trafiği, kurulduktan sonra gerçek yapay zekâ ziyaretlerinizi ölçer.',
    planTitle: 'Bu karneye uyan plan',
    starterMatch: (engines, headed) =>
      headed
        ? `${engines} motorlarını her gün izler: bu karnenin görünürlüğü bu motorlarla sayıldı.`
        : `${engines} motorlarını her gün izler.`,
    perMonth: (price) => `aylık ${price}`,
    yearly: (price) => `ya da yıllık ödemeyle ${price}: %20 indirimli`,
    starterLimits: (prompts, brands) =>
      `Her gün ${prompts} soru, ${brands} marka, Sohbet ve Ajan Merkezi.`,
    googleEngines: 'Gemini, Google AI Overviews ve Google AI Mode',
    growthLine: (engines, price, yearly, prompts, brands) =>
      `Growth, aylık ${price} ya da yıllık ${yearly} (%20 indirimli): ${engines} (1. sayfadaki Growth bandı), ${prompts} soru, ${brands} marka ve tam otomatik ajanlar ekler.`,
    ctaTitle: 'Kendi sorularınızı ölçün',
    ctaBody: (prompts, engines, questions) =>
      `Ücretsiz denemeyi başlatın: Starter ${engines} motorlarında her gün ${prompts} soru izler; bu karnenin ${questions} sorusu ve kendi sorularınızdan ${Math.max(prompts - questions, 0)} tanesi sığar.`,
    steps: (domain, questions, country) => [
      `${domain} sitesini markanız olarak ekleyin: kurulum sihirbazı genellikle birkaç dakika sürer.`,
      `Bu karnenin ${questions} sorusunu ${country} için izlemeye alın, kendi sorularınızı ekleyin.`,
      'İlk çalışmadan sonra Aksiyon Merkezi’ni açın: sıradaki işler, öncelik sırasıyla.',
    ],
    ctaLink: 'app.ansvisor.com adresinde ücretsiz denemeyi başlatın',
  },
};
