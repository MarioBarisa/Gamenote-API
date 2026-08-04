// Maps IGDB game objects into the exact RAWG-shaped JSON the two Gamenote
// clients already expect. Every field has a safe null/[] fallback.

const { cover, screenshot } = require('./images');

// unix seconds -> "YYYY-MM-DD" (or null if absent/invalid).
function dateFromUnix(unix) {
  if (!unix) return null;
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Critic score. IGDB exposes aggregated_rating (critics) & rating (users).
function metacriticOf(game) {
  const raw = game.aggregated_rating ?? game.rating ?? null;
  if (raw == null) return null;
  return Math.round(raw);
}

function genresOf(game) {
  return (game.genres || []).map((g) => ({ id: g.id, name: g.name }));
}

// ESRB rating (age_ratings with category ESRB = 1).
const ESRB_NAMES = {
  1: 'Rating Pending',
  2: 'Early Childhood',
  3: 'Everyone',
  4: 'Everyone 10+',
  5: 'Teen',
  6: 'Mature',
  7: 'Adults Only',
};

function esrbOf(game) {
  const rating = (game.age_ratings || []).find((ar) => ar.category === 1);
  if (!rating) return null;
  return { id: rating.id, name: ESRB_NAMES[rating.rating] || 'Unknown' };
}

function publishersOf(game) {
  return (game.involved_companies || [])
    .filter((ic) => ic.publisher === true)
    .map((ic) => ({ id: ic.company.id, name: ic.company.name }));
}

function platformsOf(game) {
  return (game.platforms || []).map((p) => ({ platform: { id: p.id, name: p.name } }));
}

// Official website (category 1) preferred, else first link.
function websiteOf(game) {
  const w = game.websites || [];
  const official = w.find((x) => x.category === 1);
  return (official || w[0] || {}).url || '';
}

// GameListItem (used for /games search + list results).
function toListItem(game) {
  return {
    id: game.id,
    name: game.name,
    background_image: cover(game.cover && game.cover.image_id),
    released: dateFromUnix(game.first_release_date),
    metacritic: metacriticOf(game),
    genres: genresOf(game),
    short_screenshots: (game.screenshots || []).slice(0, 10).map((s) => ({
      id: s.id,
      image: screenshot(s.image_id),
    })),
  };
}

// Full GameDetails object.
function toDetails(game) {
  const summary = (game.summary || '').trim();
  return {
    id: game.id,
    name: game.name,
    background_image: cover(game.cover && game.cover.image_id),
    background_image_additional:
      ((game.artworks && game.artworks[0]) || (game.screenshots && game.screenshots[0]) || {}).image_id
        ? screenshot(
            ((game.artworks && game.artworks[0]) || (game.screenshots && game.screenshots[0])).image_id
          )
        : null,
    released: dateFromUnix(game.first_release_date),
    metacritic: metacriticOf(game),
    description_raw: summary,
    description: summary,
    website: websiteOf(game),
    esrb_rating: esrbOf(game),
    genres: genresOf(game),
    publishers: publishersOf(game),
    platforms: platformsOf(game),
    achievements_count: 0,
    parent_achievements: [],
  };
}

module.exports = { toListItem, toDetails, dateFromUnix };