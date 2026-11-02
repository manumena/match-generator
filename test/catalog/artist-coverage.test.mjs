import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySong, parseThemeCredits } from '../../scripts/catalog/artist-coverage-audit.mjs';

const song = {
  id: 62,
  anime: 'Example anime',
  name: 'Example Song',
  path: 'Example/Example - Example Song.mp3',
  type: 'opening',
  releases: [{ sources: ['https://myanimelist.net/anime/42'] }],
};

const credit = {
  malId: 42,
  type: 'opening',
  title: 'Example Song (日本語)',
  artistCredit: 'Band feat. Singer',
  sourceUrl: 'https://myanimelist.net/anime/42',
};

test('extracts published theme cells without confusing composers or scripts with performers', () => {
  const html = `
    <p>Music: Someone Else</p>
    <script>const template = '<h2>Opening Theme</h2>';</script>
    <h2>Opening Theme</h2>
    <td width="84%">1: &quot;Example Song (日本語)&quot;<span class="theme-song-artist"> by Band &amp; Singer</span><input value="other" /></td>
    <h2>Ending Theme</h2>
    <td width="84%">&quot;Other Song&quot;<span class="theme-song-artist"> by Other Artist</span></td>`;

  assert.deepEqual(parseThemeCredits(html, 42).map(item => [item.type, item.title, item.artistCredit]), [
    ['opening', 'Example Song (日本語)', 'Band & Singer'],
    ['ending', 'Other Song', 'Other Artist'],
  ]);
});

test('requires the same release and song type while retaining the entire performer credit', () => {
  const sources = [
    { malId: 42, status: 200, credits: [credit, { ...credit, type: 'ending', artistCredit: 'Ending Singer' }] },
    { malId: 99, status: 200, credits: [{ ...credit, malId: 99, artistCredit: 'Unrelated Singer' }] },
  ];
  const result = classifySong(song, sources);

  assert.equal(result.status, 'unique_title_match');
  assert.equal(result.artistCredit, 'Band feat. Singer');
  assert.equal(result.evidence.length, 1);
});

test('does not replace localized broadcast credits with a Japanese original credit', () => {
  const result = classifySong(song, [{ malId: 42, status: 200, credits: [credit] }], {
    status: 'localized_version_review',
    reason: 'Localized recording requires its own performer evidence.',
  });

  assert.equal(result.artistCredit, null);
  assert.equal(result.status, 'localized_version_review');
});

test('keeps conflicting credits ambiguous instead of accepting the first performer', () => {
  const result = classifySong(song, [{
    malId: 42,
    status: 200,
    credits: [credit, { ...credit, artistCredit: 'Different Artist' }],
  }]);

  assert.equal(result.status, 'conflicting_credits');
  assert.equal(result.artistCredit, null);
});

test('uses a filename spelling but never a sequence number to resolve a title', () => {
  const result = classifySong({ ...song, name: 'Exampel Song', number: 3 }, [{ malId: 42, status: 200, credits: [credit] }]);
  assert.equal(result.status, 'filename_title_match');

  const unmatched = classifySong({ ...song, name: 'Wrong title', path: 'Wrong.mp3', number: 1 }, [{ malId: 42, status: 200, credits: [credit] }]);
  assert.equal(unmatched.status, 'no_title_match');
  assert.equal(unmatched.artistCredit, null);
});

test('distinguishes unavailable source pages from missing title matches', () => {
  const result = classifySong(song, [{ malId: 42, status: 403, credits: [] }]);
  assert.equal(result.status, 'source_unavailable');
});

test('reviewed Japanese titles remain distinct rather than normalizing to an empty string', () => {
  const result = classifySong(song, [{
    malId: 42,
    status: 200,
    credits: [
      { ...credit, title: 'アイドル', artistCredit: 'First Artist' },
      { ...credit, title: 'ワスレガタキ', artistCredit: 'Second Artist' },
    ],
  }], { sourceTitle: 'アイドル', reason: 'Reviewed title translation.' });

  assert.equal(result.status, 'reviewed_title_match');
  assert.equal(result.artistCredit, 'First Artist');
  assert.equal(result.evidence.length, 1);
});

test('retains a reviewed featured-performer credit only when the source title exists', () => {
  const review = {
    sourceTitle: 'Example Song feat. Guest',
    artistCredit: 'Band feat. Guest',
    reason: 'Guest is credited in the published song title.',
  };
  const source = { malId: 42, status: 200, credits: [{ ...credit, title: review.sourceTitle, artistCredit: 'Band' }] };
  const result = classifySong(song, [source], review);

  assert.equal(result.artistCredit, 'Band feat. Guest');
  assert.equal(result.status, 'reviewed_title_match');

  const missing = classifySong(song, [{ ...source, credits: [] }], review);
  assert.equal(missing.artistCredit, null);
});
