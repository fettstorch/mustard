/**
 * Image URLs Mustard can identify without fetching them first.
 *
 * Bluesky's AppView CDN URLs intentionally have no filename extension, so
 * recognize its image route in addition to conventional image filenames.
 */
export const IMAGE_URL_PATTERN = String.raw`https?:\/\/(?:(?:[^\s?#]+\.(?:png|jpe?g|gif|webp)(?::(?:large|medium|small|orig|thumb))?(?:\?[^\s]*)?(?:#[^\s]*)?)|(?:cdn\.bsky\.app\/img\/[^\s?#<>()\[\]]*\/[a-z\d]+(?:@[a-z]+)?(?:\?[^\s#<>()\[\]]*(?<![.,!?;:]))?(?:#[^\s<>()\[\]]*(?<![.,!?;:]))?))`
