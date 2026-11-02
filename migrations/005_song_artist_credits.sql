-- Reviewed artist display credits from the November 2, 2026 coverage audit.
-- Run inside one transaction, after checking the catalog migration checksum.
-- NULL deliberately represents the twelve unreviewed recording identities.
CREATE TEMP TABLE reviewed_song_artist_credits (
  song_id integer PRIMARY KEY,
  expected_anime text NOT NULL,
  expected_name text NOT NULL,
  artist_credit text
) ON COMMIT DROP;

INSERT INTO reviewed_song_artist_credits (song_id, expected_anime, expected_name, artist_credit)
VALUES
  (1, 'Another', 'Kyoumu Densen', 'ALI PROJECT'),
  (2, 'Beyblade', 'Let it Rip', NULL),
  (3, 'Black Clover', 'Haruka Mirai', 'Kankaku Piero (感覚ピエロ)'),
  (4, 'Boku no Hero Academia', 'The Day', 'Porno Graffitti'),
  (5, 'Cardcaptor Sakura', 'Catch You Catch Me', 'Gumi'),
  (6, 'Cardcaptor Sakura', 'Groovy!', 'Koumi Hirose'),
  (7, 'Chainsawman', 'Kick Back', 'Kenshi Yonezu (米津玄師)'),
  (8, 'Code Geass', 'Colors', 'FLOW'),
  (9, 'Code Geass', 'Yuukyou Seishunka', 'Ali Project'),
  (10, 'Cowboy Bebop', 'Tank!', 'The Seatbelts'),
  (11, 'Death Note', 'The World', 'Nightmare'),
  (12, 'Death Parade', 'Flyers', 'BRADIO'),
  (13, 'Demon Slayer', 'Akeboshi', 'LiSA'),
  (14, 'Demon Slayer', 'Gurenge', 'LiSA'),
  (15, 'Demon Slayer', 'Kizuna no Kiseki', 'MAN WITH A MISSION, milet'),
  (16, 'Demon Slayer', 'Zankyo Sanka', 'Aimer'),
  (17, 'Digimon Adventure', 'Butterfly', 'Kouji Wada'),
  (18, 'Digimon Adventure', 'I wish', 'AiM'),
  (19, 'Digimon Adventure 2', 'Ashita wa Atashi no Kaze ga Fuku', 'AiM'),
  (20, 'Digimon Adventure 2', 'Target ~Akai Shougeki~', 'Kouji Wada'),
  (21, 'Digimon Tamers', 'My Tomorrow', 'AiM'),
  (22, 'Digimon Tamers', 'The Biggest Dreamer', 'Kouji Wada'),
  (23, 'Dr. Stone', 'Good Morning World!', 'BURNOUT SYNDROMES'),
  (24, 'Dr. Stone', 'Sangenshoku', 'PELICAN FANCLUB'),
  (25, 'Dr. Stone', 'Wasuregataki', 'Huwie Ishizaki'),
  (26, 'Dragon Ball GT', 'Mi Corazón Encantado', NULL),
  (27, 'Dragon Ball Z', 'Boku-tachi wa Tenshi Datta', 'Hironobu Kageyama'),
  (28, 'Dragon Ball Z', 'Cha-la Head-cha-la', 'Hironobu Kageyama'),
  (29, 'Dragon Ball Z', 'Dete Koi Tobikiri ZENKAI Power!', 'MANNA'),
  (30, 'Dragon Ball Z', 'We Gotta Power', 'Hironobu Kageyama'),
  (31, 'Elfen Lied', 'Lilium', 'Kumiko Noma (野間久美子)'),
  (32, 'Erased', 'Boku Dake ga Inai Machi', NULL),
  (33, 'Evangelion', 'The Cruel Angel''s Thesis', 'Yoko Takahashi'),
  (34, 'Fire Force', 'Inferno', 'Mrs.GREEN APPLE'),
  (35, 'Food Wars', 'Kibō no Uta', 'ULTRA TOWER'),
  (36, 'Full Metal Alchemist', 'Melissa', 'Porno Graffitti'),
  (37, 'Full Metal Alchemist Brotherhood', 'Again', 'YUI'),
  (39, 'Haikyuu!!', 'Hikari Are', 'BURNOUT SYNDROMES'),
  (40, 'Hunter x Hunter', 'Departure', 'Ono Masatoshi'),
  (41, 'Jibaku Shounen Hanako kun', 'No. 7', 'Jibaku Shounen Band (Youji Ikuta from PENGUIN RESEARCH x Masayoshi Ooishi x ZiNG)'),
  (42, 'Jojo''s Bizarre Adventure', 'Bloody Stream', 'Coda'),
  (43, 'Jojo''s Bizarre Adventure', 'That Bloody Fate', 'Hiroaki TOMMY Tominaga'),
  (44, 'Jojo''s Bizarre Adventure', 'Roundabout', 'YES'),
  (45, 'Jujutsu Kaisen', 'Kaikai Kitan', 'Eve'),
  (46, 'Jujutsu Kaisen', 'Lost in Paradise', 'ALI ft. AKLO'),
  (47, 'Kaguya-sama: Love is War', 'DADDY! DADDY! DO!', 'Masayuki Suzuki feat. Airi Suzuki'),
  (48, 'Kaguya-sama: Love is War', 'GIRI GIRI', 'Masayuki Suzuki feat. Suu'),
  (49, 'Kaguya-sama: Love is War', 'Love Dramatic', 'Masayuki Suzuki feat. Rikka Ihara'),
  (50, 'Los Caballeros del Zodíaco', 'Pegasus Fantasy', 'MAKE-UP'),
  (51, 'Los Justicieros', 'Get Along', 'Masami Okui and Megumi Hayashibara'),
  (52, 'Medabots', ' ¡Sabiduría y coraje!', NULL),
  (53, 'Mikami la Cazafantasmas', 'Mikami la Cazafantasmas', NULL),
  (54, 'Miss Kobayashi''s Dragon Maid', 'Ai no Supreme!', 'fhána'),
  (55, 'Mob Psycho 100', '99', 'MOB CHOIR'),
  (56, 'Naruto', 'GO!!!', 'FLOW'),
  (58, 'Naruto', 'Haruka Kanata', 'Asian Kung-fu Generation'),
  (59, 'Naruto', 'Rocks', 'Hound Dog'),
  (60, 'Naruto', 'Seishun Kyōsōkyoku', 'Sambomaster'),
  (61, 'Naruto Shippuden', 'Blood Circulator', 'Asian Kung-Fu Generation'),
  (62, 'Naruto Shippuden', 'Blue Bird', 'Ikimonogakari'),
  (63, 'One Piece', 'We Are!', NULL),
  (64, 'One Punch Man', 'Hoshi yori Saki ni Mitsukete Ageru', 'Hiroko Moriguchi'),
  (65, 'One Punch Man', 'THE HERO !! ~Okoreru Kobushi ni Hi wo Tsukero~', 'JAM Project'),
  (66, 'Oshi no Ko', 'Idol', 'YOASOBI'),
  (67, 'Overlord', 'Clattanoia', 'O×T (Masayoshi Oishi × Tom-H@ck)'),
  (68, 'Parasyte', 'Let Me Hear', 'Fear, and Loathing in Las Vegas'),
  (69, 'Pokemon', 'Johto', NULL),
  (70, 'Pokemon', '¡Atrapalos Ya!', NULL),
  (71, 'Puella Magi Madoka Magica', 'Connect', 'ClariS'),
  (72, 'Puella Magi Madoka Magica', 'Magia', 'Kalafina'),
  (73, 'Ranma 1/2', 'Olvida la Amargura', NULL),
  (75, 'Re-ZERO: Starting Life in Another World', 'Redo', 'Konomi Suzuki'),
  (76, 'Ruroni Kenshin', 'Sobakasu', 'JUDY AND MARY'),
  (77, 'Sailor Moon', 'Legendaria Luz de Luna', NULL),
  (78, 'Serial Experiments Lain', 'Duvet', 'Bôa'),
  (79, 'Shaman King', 'Northern Lighst', 'Megumi Hayashibara'),
  (80, 'Shaman King', 'Oversoul', 'Megumi Hayashibara'),
  (81, 'Shingeki no Kyojin', 'Guren no Yumiya', 'Linked Horizon'),
  (82, 'Shingeki no Kyojin', 'Jiyuu no Tsubasa', 'Linked Horizon'),
  (83, 'Slam Dunk', 'Quiero Gritar Te Amo', NULL),
  (84, 'Spy x Family', 'Mixed Nuts', 'Official HIGE DANdism (Official髭男dism)'),
  (85, 'Spy x Family', 'Souvenir', 'BUMP OF CHICKEN'),
  (86, 'Steins; Gate', 'Hacking to the Gate', 'Kanako Itou'),
  (87, 'Sword Art Online', 'Crossing Field', 'LiSA'),
  (88, 'Sword Art Online', 'Innocence', 'Aoi Eir'),
  (89, 'Tengen Toppa Gurren Lagann', 'Sorairo Days', 'Shoko Nakagawa'),
  (90, 'Tokyo Ghoul', 'Unravel', 'TK from Ling Tosite Sigure'),
  (91, 'Tokyo Revengers', 'Cry Baby', 'Official HiGE DANdism'),
  (92, 'Vinland Saga', 'Mukanjyo', 'Survive Said The Prophet'),
  (93, 'Your Lie in April', 'Hikaru Nara', 'Goose house'),
  (94, 'Yu-gi-oh!', 'El Reino de los Duelistas', NULL),
  (95, 'Akame ga Kill', 'Skyreach', 'Sora Amamiya'),
  (96, 'Full Metal Alchemist Brotherhood', 'Golden Time Lover', 'Sukima Switch'),
  (97, 'Full Metal Alchemist Brotherhood', 'Hologram', 'NICO Touches the Walls'),
  (99, 'Full Metal Alchemist Brotherhood', 'Period', 'Chemistry'),
  (100, 'Naruto Shippuden', 'Closer', 'Inoue Joe'),
  (101, 'Naruto Shippuden', 'Crimsom Lotus', 'DOES'),
  (102, 'Naruto Shippuden', 'Distance', 'LONG SHOT PARTY'),
  (103, 'Naruto Shippuden', 'Diver', 'NICO Touches the Walls'),
  (104, 'Naruto Shippuden', 'Hero''s Come Back!!', 'Nobodyknows+'),
  (105, 'Naruto Shippuden', 'Hotaru no Hikari', 'Ikimonogakari'),
  (106, 'Naruto Shippuden', 'Kara no Kokoro', 'Anly'),
  (107, 'Naruto Shippuden', 'Kaze', 'Yamazaru'),
  (108, 'Naruto Shippuden', 'Line', 'Sukima Switch'),
  (109, 'Naruto Shippuden', 'Lover', '7!!'),
  (110, 'Naruto Shippuden', 'Moshimo', 'Daisuke'),
  (111, 'Naruto Shippuden', 'Newsong', 'tacica'),
  (112, 'Naruto Shippuden', 'Not Even Sudden Rain Can Defeat Me', 'NICO Touches the Walls'),
  (113, 'Naruto Shippuden', 'Sign', 'FLOW'),
  (114, 'Naruto Shippuden', 'Silhouette', 'KANA-BOON'),
  (115, 'Naruto Shippuden', 'Tosugeki Rock', 'THE CRO-MAGNONS'),
  (116, 'Naruto Shippuden', 'Toumei datta Sekai', 'Motohiro Hata'),
  (117, 'Naruto Shippuden', 'Tsuki no Ookisa', 'Nogizaka46'),
  (118, 'Mashle: Magic and Muscles', 'Bling-Bang-Bang-Born', 'Creepy Nuts'),
  (119, 'Mashle: Magic and Muscles', 'Knock Out', 'Taiiku Okazaki'),
  (120, 'Hell''s Paradise', 'Work', 'millennium parade and Sheena Ringo'),
  (122, 'Dragon Ball Super', 'Chōzetsu ☆ Dynamic!', 'Kazuya Yoshii (吉井和哉)'),
  (123, 'Dragon Ball Super', 'Genkai Toppa', 'Kiyoshi Hikawa (氷川きよし)'),
  (124, 'Jujutsu Kaisen', 'Vivid Vice', 'Who-ya Extended'),
  (125, 'Jujutsu Kaisen', 'Ao no Sumika', 'Tatsuya Kitani (キタニタツヤ)'),
  (126, 'Jujutsu Kaisen', 'Specialz', 'King Gnu'),
  (127, 'Nanatsu no Taizai', 'Netsujou no Spectrum', 'Ikimonogakari'),
  (128, 'Nanatsu no Taizai', 'Howling', 'FLOW x GRANRODEO'),
  (129, 'Nanatsu no Taizai', 'Rob the Frontier', 'UVERworld'),
  (130, 'Nanatsu no Taizai', 'Ame ga Furu kara Niji ga Deru', 'Sky Peace (スカイピース)');

-- Reject stale IDs/titles before adding the column or writing any credits.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.songs) <> 125 OR EXISTS (
    SELECT 1
    FROM reviewed_song_artist_credits expected
    LEFT JOIN public.songs actual ON actual.id = expected.song_id
    WHERE actual.id IS NULL
       OR actual.anime IS DISTINCT FROM expected.expected_anime
       OR actual.name IS DISTINCT FROM expected.expected_name
  ) THEN
    RAISE EXCEPTION 'Song catalog differs from the reviewed 125-song artist audit';
  END IF;
END $$;

ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS artist_credit text
    CHECK (artist_credit IS NULL OR (artist_credit = btrim(artist_credit) AND artist_credit <> ''));

-- Never overwrite conflicting editorial work, including a manually reviewed
-- credit on one of the twelve songs that this audit deliberately leaves empty.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.songs actual
    JOIN reviewed_song_artist_credits expected ON expected.song_id = actual.id
    WHERE actual.artist_credit IS NOT NULL
      AND actual.artist_credit IS DISTINCT FROM expected.artist_credit
  ) THEN
    RAISE EXCEPTION 'Existing artist credits conflict with this reviewed batch';
  END IF;
END $$;

UPDATE public.songs actual
SET artist_credit = expected.artist_credit
FROM reviewed_song_artist_credits expected
WHERE actual.id = expected.song_id
  AND actual.artist_credit IS NULL
  AND expected.artist_credit IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.songs actual
    JOIN reviewed_song_artist_credits expected ON expected.song_id = actual.id
    WHERE actual.artist_credit IS DISTINCT FROM expected.artist_credit
  ) OR (SELECT count(*) FROM public.songs WHERE artist_credit IS NOT NULL) <> 113 THEN
    RAISE EXCEPTION 'Artist credit validation failed; expected 113 credits and 12 NULLs';
  END IF;
END $$;
