export const formatTokens = (tokens: number) =>
  tokens >= 1_000_000
    ? `${+(tokens / 1_000_000).toFixed(2)}M`
    : tokens >= 1_000
      ? `${+(tokens / 1_000).toFixed(1)}K`
      : String(tokens)
