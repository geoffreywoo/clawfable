/** Only provider-supplied, valid private counts distinguish zero from unknown. */
export function privateClickMetrics(metrics: unknown) {
  const values = metrics && typeof metrics === 'object' && !Array.isArray(metrics) ? metrics as Record<string, unknown> : {};
  const count = (key: string) => Object.hasOwn(values, key) && typeof values[key] === 'number'
    && Number.isSafeInteger(values[key]) && values[key] >= 0 ? values[key] as number : null;
  const profileClicks = count('user_profile_clicks'), urlClicks = count('url_link_clicks');
  return { profileClicks, urlClicks, privateMetricAvailability: { profileClicks: profileClicks !== null, urlClicks: urlClicks !== null } };
}
