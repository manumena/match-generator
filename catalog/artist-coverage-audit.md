# Artist coverage audit

Audited November 2, 2026. Read-only: no database records, schema, media files or runtime game behavior were changed.

The owner confirmed that uploads are original/broadcast recordings rather than fan covers, and that Japanese-titled tracks use Japanese recordings. Source matches use that confirmation; waveforms were not independently verified. Localized titles remain held for localized broadcast-credit review.

## Coverage

Usable original-theme credits: 113 of 125 songs, using the owner-confirmed recording provenance. Held for further identification: 12.

| Result | Songs |
| --- | ---: |
| unique_title_match | 96 |
| localized_version_review | 10 |
| reviewed_title_match | 15 |
| needs_title_review | 1 |
| conflicting_credits | 1 |
| filename_title_match | 2 |

Checked 153 mapped release pages; 0 pages were unavailable.

## Method and limitations

- Start from all 125 songs and their existing canonical answer/release provider IDs, exported using SELECT only.
- Match published opening/ending credits only within those release IDs and the stored song type. Normalize case, accents, punctuation and parenthetical Japanese spellings. Do not use global fuzzy title matching or the unreliable sequence numbers.
- Use the existing filename as secondary spelling evidence. Explicit reviewed translations, romanizations and title corrections are documented in artist-coverage-review.json; no song names were changed. Supplement the performer field when the published title itself identifies a featured singer.
- Preserve the full performer credit, including collaborations and featured artists. Do not silently truncate to the first singer or replace performers with composers.
- Duplicate appearances with the same performer credit are compatible. Different performer credits remain ambiguous.
- AnimeThemes returned an HTTP 403 access page. Jikan was unreachable. Neither failure is treated as zero coverage; this audit uses independently published MyAnimeList pages instead.
- Source HTML and export stay in the ignored cache. Public facts, source URLs and review decisions are recorded here and in the JSON companion. This report is not an artist import or permission to publish uncertain credits.

## Held songs

- **2: Beyblade — Let it Rip.** English broadcast title; the original Japanese Beyblade opening credit is not sufficient.
- **26: Dragon Ball GT — Mi Corazón Encantado.** Spanish broadcast title; verify the Latin American GT performer, not the original Japanese artist.
- **32: Erased — Boku Dake ga Inai Machi.** Boku Dake ga Inai Machi is the anime title, not the published song title. The mapped release credits Re:Re: to Asian Kung-Fu Generation, but the actual track must be identified before assigning that performer.
- **52: Medabots —  ¡Sabiduría y coraje!.** Spanish broadcast opening; requires localized-version performer evidence.
- **53: Mikami la Cazafantasmas — Mikami la Cazafantasmas.** Stored title is the localized show title; identify the actual recording and performer.
- **63: One Piece — We Are!.** Matching releases list different performer credits.
- **69: Pokemon — Johto.** Johto is not a unique song/language identity; identify the specific localized broadcast recording.
- **70: Pokemon — ¡Atrapalos Ya!.** Spanish Pokémon theme; verify the localized broadcast performer.
- **73: Ranma 1/2 — Olvida la Amargura.** Spanish Ranma opening; the Japanese original's credit cannot be substituted.
- **77: Sailor Moon — Legendaria Luz de Luna.** Spanish Sailor Moon theme; verify the localized broadcast performer.
- **83: Slam Dunk — Quiero Gritar Te Amo.** Spanish Slam Dunk theme; verify the localized broadcast performer.
- **94: Yu-gi-oh! — El Reino de los Duelistas.** Localized Yu-Gi-Oh title; identify the actual broadcast theme before crediting a performer.

## Storage decision

The owner selected nullable public.songs.artist_credit for the display credit. Migration 005_song_artist_credits imports the 113 reviewed credits and leaves these 12 uncertain songs NULL. The legacy manual-game API now selects its original fields explicitly; multiplayer exposes optional artistCredit only in a revealed result. Evidence and review decisions remain in these audit files. The audit itself was read-only; applying the migration is a separate operation.

## Reproduce

Run the following from the backend repository. Export reads the configured database; fetch uses spaced public GETs and reuses the ignored source cache; report only reads local files. The final command runs the audit matching tests.

```sh
node --env-file=.dev.vars scripts/catalog/artist-coverage-audit.mjs export
node scripts/catalog/artist-coverage-audit.mjs fetch
node scripts/catalog/artist-coverage-audit.mjs report
node --test test/catalog/artist-coverage.test.mjs
```

## Song-by-song results

| ID | Anime | Stored song title | Performer credit | Result | Evidence / remaining work |
| ---: | --- | --- | --- | --- | --- |
| 1 | Another | Kyoumu Densen | ALI PROJECT | unique_title_match | [source 1](https://myanimelist.net/anime/11111) |
| 2 | Beyblade | Let it Rip | — | localized_version_review | English broadcast title; the original Japanese Beyblade opening credit is not sufficient. |
| 3 | Black Clover | Haruka Mirai | Kankaku Piero (感覚ピエロ) | unique_title_match | [source 1](https://myanimelist.net/anime/34572) |
| 4 | Boku no Hero Academia | The Day | Porno Graffitti | unique_title_match | [source 1](https://myanimelist.net/anime/31964) |
| 5 | Cardcaptor Sakura | Catch You Catch Me | Gumi | unique_title_match | [source 1](https://myanimelist.net/anime/232) |
| 6 | Cardcaptor Sakura | Groovy! | Koumi Hirose | unique_title_match | [source 1](https://myanimelist.net/anime/232) |
| 7 | Chainsawman | Kick Back | Kenshi Yonezu (米津玄師) | unique_title_match | [source 1](https://myanimelist.net/anime/44511) |
| 8 | Code Geass | Colors | FLOW | unique_title_match | [source 1](https://myanimelist.net/anime/1575) |
| 9 | Code Geass | Yuukyou Seishunka | Ali Project | unique_title_match | [source 1](https://myanimelist.net/anime/1575) |
| 10 | Cowboy Bebop | Tank! | The Seatbelts | unique_title_match | [source 1](https://myanimelist.net/anime/1) |
| 11 | Death Note | The World | Nightmare | unique_title_match | [source 1](https://myanimelist.net/anime/1535) |
| 12 | Death Parade | Flyers | BRADIO | unique_title_match | [source 1](https://myanimelist.net/anime/28223) |
| 13 | Demon Slayer | Akeboshi | LiSA | unique_title_match | [source 1](https://myanimelist.net/anime/49926) |
| 14 | Demon Slayer | Gurenge | LiSA | unique_title_match | [source 1](https://myanimelist.net/anime/38000) |
| 15 | Demon Slayer | Kizuna no Kiseki | MAN WITH A MISSION, milet | unique_title_match | [source 1](https://myanimelist.net/anime/51019) |
| 16 | Demon Slayer | Zankyo Sanka | Aimer | reviewed_title_match | [source 1](https://myanimelist.net/anime/47778), [source 2](https://sonymusic.com.tw/album/aimer-zankyo-sanka-asa-ga-kuru-standard-edition/), [source 3](https://www.sonymusic.co.jp/artist/aimer/info/535793) |
| 17 | Digimon Adventure | Butterfly | Kouji Wada | unique_title_match | [source 1](https://myanimelist.net/anime/552) |
| 18 | Digimon Adventure | I wish | AiM | unique_title_match | [source 1](https://myanimelist.net/anime/552) |
| 19 | Digimon Adventure 2 | Ashita wa Atashi no Kaze ga Fuku | AiM | unique_title_match | [source 1](https://myanimelist.net/anime/1313) |
| 20 | Digimon Adventure 2 | Target ~Akai Shougeki~ | Kouji Wada | unique_title_match | [source 1](https://myanimelist.net/anime/1313) |
| 21 | Digimon Tamers | My Tomorrow | AiM | unique_title_match | [source 1](https://myanimelist.net/anime/874) |
| 22 | Digimon Tamers | The Biggest Dreamer | Kouji Wada | unique_title_match | [source 1](https://myanimelist.net/anime/874) |
| 23 | Dr. Stone | Good Morning World! | BURNOUT SYNDROMES | unique_title_match | [source 1](https://myanimelist.net/anime/38691) |
| 24 | Dr. Stone | Sangenshoku | PELICAN FANCLUB | unique_title_match | [source 1](https://myanimelist.net/anime/38691) |
| 25 | Dr. Stone | Wasuregataki | Huwie Ishizaki | reviewed_title_match | [source 1](https://myanimelist.net/anime/48549), [source 2](https://dr-stone.jp/news/4065/), [source 3](https://dr-stone.fandom.com/wiki/Wasuregataki) |
| 26 | Dragon Ball GT | Mi Corazón Encantado | — | localized_version_review | Spanish broadcast title; verify the Latin American GT performer, not the original Japanese artist. |
| 27 | Dragon Ball Z | Boku-tachi wa Tenshi Datta | Hironobu Kageyama | unique_title_match | [source 1](https://myanimelist.net/anime/813) |
| 28 | Dragon Ball Z | Cha-la Head-cha-la | Hironobu Kageyama | unique_title_match | [source 1](https://myanimelist.net/anime/813) |
| 29 | Dragon Ball Z | Dete Koi Tobikiri ZENKAI Power! | MANNA | unique_title_match | [source 1](https://myanimelist.net/anime/813) |
| 30 | Dragon Ball Z | We Gotta Power | Hironobu Kageyama | unique_title_match | [source 1](https://myanimelist.net/anime/813) |
| 31 | Elfen Lied | Lilium | Kumiko Noma (野間久美子) | unique_title_match | [source 1](https://myanimelist.net/anime/226) |
| 32 | Erased | Boku Dake ga Inai Machi | — | needs_title_review | [source 1](https://myanimelist.net/anime/31043) |
| 33 | Evangelion | The Cruel Angel's Thesis | Yoko Takahashi | reviewed_title_match | [source 1](https://myanimelist.net/anime/30) |
| 34 | Fire Force | Inferno | Mrs.GREEN APPLE | unique_title_match | [source 1](https://myanimelist.net/anime/38671) |
| 35 | Food Wars | Kibō no Uta | ULTRA TOWER | reviewed_title_match | [source 1](https://myanimelist.net/anime/28171) |
| 36 | Full Metal Alchemist | Melissa | Porno Graffitti | unique_title_match | [source 1](https://myanimelist.net/anime/121) |
| 37 | Full Metal Alchemist Brotherhood | Again | YUI | unique_title_match | [source 1](https://myanimelist.net/anime/5114) |
| 39 | Haikyuu!! | Hikari Are | BURNOUT SYNDROMES | unique_title_match | [source 1](https://myanimelist.net/anime/32935) |
| 40 | Hunter x Hunter | Departure | Ono Masatoshi | unique_title_match | [source 1](https://myanimelist.net/anime/11061) |
| 41 | Jibaku Shounen Hanako kun | No. 7 | Jibaku Shounen Band (Youji Ikuta from PENGUIN RESEARCH x Masayoshi Ooishi x ZiNG) | unique_title_match | [source 1](https://myanimelist.net/anime/39534) |
| 42 | Jojo's Bizarre Adventure | Bloody Stream | Coda | unique_title_match | [source 1](https://myanimelist.net/anime/14719) |
| 43 | Jojo's Bizarre Adventure | That Bloody Fate | Hiroaki TOMMY Tominaga | reviewed_title_match | [source 1](https://myanimelist.net/anime/14719), [source 2](https://jojowiki.com/JoJo_~Sono_Chi_no_Sadame~) |
| 44 | Jojo's Bizarre Adventure | Roundabout | YES | unique_title_match | [source 1](https://myanimelist.net/anime/14719) |
| 45 | Jujutsu Kaisen | Kaikai Kitan | Eve | unique_title_match | [source 1](https://myanimelist.net/anime/40748) |
| 46 | Jujutsu Kaisen | Lost in Paradise | ALI ft. AKLO | unique_title_match | [source 1](https://myanimelist.net/anime/40748) |
| 47 | Kaguya-sama: Love is War | DADDY! DADDY! DO! | Masayuki Suzuki feat. Airi Suzuki | reviewed_title_match | [source 1](https://myanimelist.net/anime/40591), [source 2](https://kaguya.love/3rd/news/?article_id=60220) |
| 48 | Kaguya-sama: Love is War | GIRI GIRI | Masayuki Suzuki feat. Suu | reviewed_title_match | [source 1](https://myanimelist.net/anime/43608), [source 2](https://kaguya.love/3rd/news/?article_id=60220) |
| 49 | Kaguya-sama: Love is War | Love Dramatic | Masayuki Suzuki feat. Rikka Ihara | reviewed_title_match | [source 1](https://myanimelist.net/anime/37999) |
| 50 | Los Caballeros del Zodíaco | Pegasus Fantasy | MAKE-UP | unique_title_match | [source 1](https://myanimelist.net/anime/1254) |
| 51 | Los Justicieros | Get Along | Masami Okui and Megumi Hayashibara | unique_title_match | [source 1](https://myanimelist.net/anime/534) |
| 52 | Medabots |  ¡Sabiduría y coraje! | — | localized_version_review | Spanish broadcast opening; requires localized-version performer evidence. |
| 53 | Mikami la Cazafantasmas | Mikami la Cazafantasmas | — | localized_version_review | Stored title is the localized show title; identify the actual recording and performer. |
| 54 | Miss Kobayashi's Dragon Maid | Ai no Supreme! | fhána | unique_title_match | [source 1](https://myanimelist.net/anime/39247) |
| 55 | Mob Psycho 100 | 99 | MOB CHOIR | unique_title_match | [source 1](https://myanimelist.net/anime/32182) |
| 56 | Naruto | GO!!! | FLOW | unique_title_match | [source 1](https://myanimelist.net/anime/20) |
| 58 | Naruto | Haruka Kanata | Asian Kung-fu Generation | unique_title_match | [source 1](https://myanimelist.net/anime/20) |
| 59 | Naruto | Rocks | Hound Dog | unique_title_match | [source 1](https://myanimelist.net/anime/20) |
| 60 | Naruto | Seishun Kyōsōkyoku | Sambomaster | unique_title_match | [source 1](https://myanimelist.net/anime/20) |
| 61 | Naruto Shippuden | Blood Circulator | Asian Kung-Fu Generation | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 62 | Naruto Shippuden | Blue Bird | Ikimonogakari | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 63 | One Piece | We Are! | — | conflicting_credits | [source 1](https://myanimelist.net/anime/21) |
| 64 | One Punch Man | Hoshi yori Saki ni Mitsukete Ageru | Hiroko Moriguchi | unique_title_match | [source 1](https://myanimelist.net/anime/30276) |
| 65 | One Punch Man | THE HERO !! ~Okoreru Kobushi ni Hi wo Tsukero~ | JAM Project | unique_title_match | [source 1](https://myanimelist.net/anime/30276) |
| 66 | Oshi no Ko | Idol | YOASOBI | reviewed_title_match | [source 1](https://myanimelist.net/anime/52034), [source 2](https://www.yoasobi-music.jp/news/552387) |
| 67 | Overlord | Clattanoia | O×T (Masayoshi Oishi × Tom-H@ck) | unique_title_match | [source 1](https://myanimelist.net/anime/29803) |
| 68 | Parasyte | Let Me Hear | Fear, and Loathing in Las Vegas | unique_title_match | [source 1](https://myanimelist.net/anime/22535) |
| 69 | Pokemon | Johto | — | localized_version_review | Johto is not a unique song/language identity; identify the specific localized broadcast recording. |
| 70 | Pokemon | ¡Atrapalos Ya! | — | localized_version_review | Spanish Pokémon theme; verify the localized broadcast performer. |
| 71 | Puella Magi Madoka Magica | Connect | ClariS | unique_title_match | [source 1](https://myanimelist.net/anime/9756) |
| 72 | Puella Magi Madoka Magica | Magia | Kalafina | unique_title_match | [source 1](https://myanimelist.net/anime/9756) |
| 73 | Ranma 1/2 | Olvida la Amargura | — | localized_version_review | Spanish Ranma opening; the Japanese original's credit cannot be substituted. |
| 75 | Re-ZERO: Starting Life in Another World | Redo | Konomi Suzuki | unique_title_match | [source 1](https://myanimelist.net/anime/31240) |
| 76 | Ruroni Kenshin | Sobakasu | JUDY AND MARY | unique_title_match | [source 1](https://myanimelist.net/anime/45) |
| 77 | Sailor Moon | Legendaria Luz de Luna | — | localized_version_review | Spanish Sailor Moon theme; verify the localized broadcast performer. |
| 78 | Serial Experiments Lain | Duvet | Bôa | unique_title_match | [source 1](https://myanimelist.net/anime/339) |
| 79 | Shaman King | Northern Lighst | Megumi Hayashibara | filename_title_match | [source 1](https://myanimelist.net/anime/154) |
| 80 | Shaman King | Oversoul | Megumi Hayashibara | unique_title_match | [source 1](https://myanimelist.net/anime/154) |
| 81 | Shingeki no Kyojin | Guren no Yumiya | Linked Horizon | unique_title_match | [source 1](https://myanimelist.net/anime/16498) |
| 82 | Shingeki no Kyojin | Jiyuu no Tsubasa | Linked Horizon | unique_title_match | [source 1](https://myanimelist.net/anime/16498) |
| 83 | Slam Dunk | Quiero Gritar Te Amo | — | localized_version_review | Spanish Slam Dunk theme; verify the localized broadcast performer. |
| 84 | Spy x Family | Mixed Nuts | Official HIGE DANdism (Official髭男dism) | unique_title_match | [source 1](https://myanimelist.net/anime/50265) |
| 85 | Spy x Family | Souvenir | BUMP OF CHICKEN | unique_title_match | [source 1](https://myanimelist.net/anime/50602) |
| 86 | Steins; Gate | Hacking to the Gate | Kanako Itou | unique_title_match | [source 1](https://myanimelist.net/anime/9253) |
| 87 | Sword Art Online | Crossing Field | LiSA | unique_title_match | [source 1](https://myanimelist.net/anime/11757) |
| 88 | Sword Art Online | Innocence | Aoi Eir | unique_title_match | [source 1](https://myanimelist.net/anime/11757) |
| 89 | Tengen Toppa Gurren Lagann | Sorairo Days | Shoko Nakagawa | unique_title_match | [source 1](https://myanimelist.net/anime/2001) |
| 90 | Tokyo Ghoul | Unravel | TK from Ling Tosite Sigure | unique_title_match | [source 1](https://myanimelist.net/anime/22319) |
| 91 | Tokyo Revengers | Cry Baby | Official HiGE DANdism | unique_title_match | [source 1](https://myanimelist.net/anime/42249) |
| 92 | Vinland Saga | Mukanjyo | Survive Said The Prophet | unique_title_match | [source 1](https://myanimelist.net/anime/37521) |
| 93 | Your Lie in April | Hikaru Nara | Goose house | unique_title_match | [source 1](https://myanimelist.net/anime/23273) |
| 94 | Yu-gi-oh! | El Reino de los Duelistas | — | localized_version_review | Localized Yu-Gi-Oh title; identify the actual broadcast theme before crediting a performer. |
| 95 | Akame ga Kill | Skyreach | Sora Amamiya | unique_title_match | [source 1](https://myanimelist.net/anime/22199) |
| 96 | Full Metal Alchemist Brotherhood | Golden Time Lover | Sukima Switch | unique_title_match | [source 1](https://myanimelist.net/anime/5114) |
| 97 | Full Metal Alchemist Brotherhood | Hologram | NICO Touches the Walls | unique_title_match | [source 1](https://myanimelist.net/anime/5114) |
| 99 | Full Metal Alchemist Brotherhood | Period | Chemistry | unique_title_match | [source 1](https://myanimelist.net/anime/5114) |
| 100 | Naruto Shippuden | Closer | Inoue Joe | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 101 | Naruto Shippuden | Crimsom Lotus | DOES | reviewed_title_match | [source 1](https://myanimelist.net/anime/1735), [source 2](https://naruto.fandom.com/wiki/Crimson_Lotus), [source 3](https://naruto-official.com/en/anime/naruto2) |
| 102 | Naruto Shippuden | Distance | LONG SHOT PARTY | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 103 | Naruto Shippuden | Diver | NICO Touches the Walls | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 104 | Naruto Shippuden | Hero's Come Back!! | Nobodyknows+ | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 105 | Naruto Shippuden | Hotaru no Hikari | Ikimonogakari | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 106 | Naruto Shippuden | Kara no Kokoro | Anly | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 107 | Naruto Shippuden | Kaze | Yamazaru | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 108 | Naruto Shippuden | Line | Sukima Switch | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 109 | Naruto Shippuden | Lover | 7!! | filename_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 110 | Naruto Shippuden | Moshimo | Daisuke | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 111 | Naruto Shippuden | Newsong | tacica | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 112 | Naruto Shippuden | Not Even Sudden Rain Can Defeat Me | NICO Touches the Walls | reviewed_title_match | [source 1](https://myanimelist.net/anime/1735), [source 2](https://naruto.fandom.com/wiki/Not_Even_Sudden_Rain_Can_Defeat_Me), [source 3](https://naruto-official.com/en/anime/naruto2) |
| 113 | Naruto Shippuden | Sign | FLOW | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 114 | Naruto Shippuden | Silhouette | KANA-BOON | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 115 | Naruto Shippuden | Tosugeki Rock | THE CRO-MAGNONS | reviewed_title_match | [source 1](https://myanimelist.net/anime/1735), [source 2](https://naruto-official.com/en/anime/naruto2) |
| 116 | Naruto Shippuden | Toumei datta Sekai | Motohiro Hata | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 117 | Naruto Shippuden | Tsuki no Ookisa | Nogizaka46 | unique_title_match | [source 1](https://myanimelist.net/anime/1735) |
| 118 | Mashle: Magic and Muscles | Bling-Bang-Bang-Born | Creepy Nuts | unique_title_match | [source 1](https://myanimelist.net/anime/55813) |
| 119 | Mashle: Magic and Muscles | Knock Out | Taiiku Okazaki | unique_title_match | [source 1](https://myanimelist.net/anime/52211) |
| 120 | Hell's Paradise | Work | millennium parade and Sheena Ringo | reviewed_title_match | [source 1](https://myanimelist.net/anime/46569) |
| 122 | Dragon Ball Super | Chōzetsu ☆ Dynamic! | Kazuya Yoshii (吉井和哉) | reviewed_title_match | [source 1](https://myanimelist.net/anime/30694) |
| 123 | Dragon Ball Super | Genkai Toppa | Kiyoshi Hikawa (氷川きよし) | reviewed_title_match | [source 1](https://myanimelist.net/anime/30694) |
| 124 | Jujutsu Kaisen | Vivid Vice | Who-ya Extended | unique_title_match | [source 1](https://myanimelist.net/anime/40748) |
| 125 | Jujutsu Kaisen | Ao no Sumika | Tatsuya Kitani (キタニタツヤ) | unique_title_match | [source 1](https://myanimelist.net/anime/51009) |
| 126 | Jujutsu Kaisen | Specialz | King Gnu | unique_title_match | [source 1](https://myanimelist.net/anime/51009) |
| 127 | Nanatsu no Taizai | Netsujou no Spectrum | Ikimonogakari | unique_title_match | [source 1](https://myanimelist.net/anime/23755) |
| 128 | Nanatsu no Taizai | Howling | FLOW x GRANRODEO | unique_title_match | [source 1](https://myanimelist.net/anime/34577) |
| 129 | Nanatsu no Taizai | Rob the Frontier | UVERworld | unique_title_match | [source 1](https://myanimelist.net/anime/39701) |
| 130 | Nanatsu no Taizai | Ame ga Furu kara Niji ga Deru | Sky Peace (スカイピース) | unique_title_match | [source 1](https://myanimelist.net/anime/34577) |
