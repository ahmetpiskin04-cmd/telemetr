# Fiyat alarmları

Alarmlar **yalnızca bilgilendirir**. Alım-satım yapmaz, aracı kuruma ya da bankaya bağlanmaz; kararı ve işlemi sen verirsin.

## Çalıştırma

1. Uygulamayı her zamanki gibi aç (masaüstü kısayolu ya da `npm start`). Alarm kontrolü uygulamayla birlikte başlar.
2. Üst çubuktaki **Alarmlar** düğmesinden alarm ekle, aç/kapat, düzenle ya da sil.
3. Pencereyi kapatırsan uygulama **sistem tepsisine küçülür** ve alarmlar kontrol edilmeye devam eder. Gerçek çıkış için tepsi simgesine sağ tıkla → **Çık**.
4. İlk açılışta uygulama **Windows girişinde kendiliğinden başlamayı** açar (pencere açmadan, tepsiye yerleşir). Tepsi menüsündeki **Windows ile başlat** kutusundan kapatabilirsin; bir kez kapattıktan sonra yeniden açılmaz.

> Kısayol, proje klasörünü gösterdiği için klasörü taşırsan Windows ile başlatma kaydı eski yolda kalır. Taşıdıktan sonra uygulamayı yeni yerinden aç ve tepsi menüsünde **Windows ile başlat** kutusunu işaretle (işaretliyse bir kez kapatıp yeniden işaretle).

## Alarm türleri

| Tür | Ne zaman bildirir |
| --- | --- |
| Fiyat eşiği | Fiyat eşiğin altına düşünce ya da üstüne çıkınca |
| Günlük değişim | Bir önceki kapanışa göre bugün %N'den fazla düşünce ya da yükselince |
| Ortalama kıyası | Fiyat son 20 günlük kapanış ortalamasının %N altına inince |
| Zarar sınırı | Toplam hisse zararı sınırın %80'ine ulaşınca, sonra sınırı aşınca. "Sat" demez, yalnızca "durup gözden geçirme zamanı" der |

İzlenen varlıklar: ASELS, BIMAS, ENJSA, EREGL, TUPRS, gram altın (TL), ons altın (USD) ve USD/TRY. Liste **Alarmlar → Ayarlar** sekmesinden değişir. Ons altın Yahoo'da spot olmadığı için vadeli kontrattır (GC=F) ve bildirimde "(vadeli)" yazar.

Zarar sınırı yalnızca adet ve maliyeti girilmiş **hisseleri** sayar (altın ve fonlar dışarıda). Bir hissenin fiyatı alınamazsa zarar eksik hesaplanmasın diye o tur atlanır.

## Alarm ekleme örneği

**Alarmlar → Yeni alarm** ile:

- Tür: Fiyat eşiği · Varlık: BIMAS · Koşul: Altına düşerse · Eşik: 385
- Bekleme süresi boş (varsayılan 24 saat), Tek seferlik işaretsiz

Fiyat 385 TL'nin altına inince şöyle bir bildirim gelir:

> BIMAS 380,10 TL: belirlediğin 385 TL alarmının altına indi.

Borsa verisi gecikmeliyse cümlenin sonuna "(gecikmeli veri)" eklenir.

## Davranış kuralları

- **Yalnızca geçişte tetiklenir.** Alarm eklendiği anda fiyat zaten eşiğin ötesindeyse hemen çalmaz; listede *"Beklemede: fiyat henüz eşiğin güvenli tarafına dönmedi"* yazar. Fiyat güvenli tarafa dönüp eşiği yeniden geçince çalar.
- **Zarar sınırı alarmı** kurulurken zarar zaten sınırın %80'ini geçmişse silahsız bırakılmaz; kurulum anında bir kez bilgi mesajı gider ("şu an zarar X TL, sınırın %Y seviyesinde"), sonra normal çalışır.
- **Bekleme süresi** (varsayılan 24 saat): aynı alarm bu süre dolmadan tekrar çalmaz. Zarar sınırında uyarıdan "aşıldı"ya geçiş bekleme süresine takılmaz.
- **Tek seferlik** alarm bir kez çalınca kendini kapatır. Zarar sınırında yalnızca "aşıldı" uyarısından sonra kapanır.
- **Seans:** BİST hisseleri yalnızca hafta içi 10:00-18:00 (İstanbul) kontrol edilir; Yahoo borsanın açık olmadığını söylüyorsa (resmî tatil) bildirmez. Altın ve döviz her zaman kontrol edilir. Kontrol aralığı Ayarlar'dan değişir (varsayılan 5 dakika).
- **Veri alınamazsa** alarm sessizce atlanır, uygulama çökmez. Hatalar `data/alerts.log` dosyasına yazılır (paketli sürümde `%APPDATA%\telemetr\data\alerts.log`).

## Ayarlar (hepsi Ayarlar sekmesinde, kodda sabit değil)

Zarar sınırı (varsayılan 1.800 TL), ilk uyarı oranı (%80), kontrol aralığı, varsayılan bekleme süresi, Telegram açık/kapalı ve izlenen varlık listesi. Hepsi `data/alarms.json` dosyasında saklanır; uygulama kapanınca kaybolmaz.

## Telegram

1. @BotFather ile bir bot oluştur, token'ı al. Bota bir mesaj yaz, chat id'ni öğren.
2. `C:\Users\<sen>\.evim\telemetr.env` dosyasına şu iki satırı ekle (anahtarlar kodda ya da depoda durmaz):

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

3. Uygulamayı yeniden başlat. **Alarmlar → Ayarlar → Deneme bildirimi gönder** ile kanalları dene.

Anahtar tanımlı değilse Telegram kanalı sessizce atlanır; Windows bildirimi yine gider.

## Sahte fiyatla alarmı test etme

Gerçek alarmlarına ve portföyüne dokunmaz; geçici klasörde çalışır. Her senaryo üç adımdır: güvenli tarafta başlangıç (bildirim yok), sahte fiyat eşiği geçer (tek bildirim), aynı fiyatta tekrar (bildirim yok).

```
npm run alarm:test -- fiyat BIMAS 380 --esik 385
npm run alarm:test -- fiyat BIMAS 390 --esik 385 --yon ust --gecikmeli
npm run alarm:test -- gunluk ASELS 96,5 --onceki-kapanis 100 --yuzde 3
npm run alarm:test -- ortalama EREGL 37 --ortalama 40 --yuzde 5
npm run alarm:test -- zarar 1500                    # sınır ve oran: --sinir 1800 --oran 80
npm run alarm:test -- fiyat ONS_ALTIN 3590 --esik 3600
```

Çıktı bildirim metnini yazar; beklendiği gibiyse çıkış kodu 0'dır. `--telegram` eklersen bildirim gerçek Telegram botuna da gider (anahtarlar `~/.evim/telemetr.env` dosyasından okunur).

Birim testleri: `npm test` (eşik geçişi, bekleme süresi, seans dışı davranış, zarar sınırı, bildirim kanalları, arka planda çalışma).

## Veri kaynağı

Tüm fiyatlar tek modülden gelir: `src/alerts/price-feed.js`. BİST, USD/TRY ve ons altın Yahoo'dan, gram altın Harem Altın'dan alınır. Başka bir sağlayıcıya geçmek için yalnızca bu dosya değişir.
