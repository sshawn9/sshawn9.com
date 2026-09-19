// The agreed 57 columns. Source data does not add columns dynamically.
export const columns = {};
for (const [type, names] of Object.entries({
  TEXT: `id invocation_id collection_status local_started_at measurement_id measurement_created_at
    url request_method request_from request_headers_json cli_argv_json
    probe_country probe_state probe_city probe_network probe_tags_json
    result_status cache_status cf_colo resolved_address content_media_type content_encoding etag last_modified_utc
    vary_fields_json failure_source raw_output tls_error call_error_code call_error_message
    cli_stderr parse_issues_json source_json`,
  INTEGER: `probe_index request_limit measurement_probes_count probe_asn http_status_code age_seconds truncated
    cc_max_age_seconds cc_s_maxage_seconds cc_no_store cc_no_cache cc_private cc_must_revalidate vary_star
    dns_ms tcp_ms tls_ms first_byte_ms download_ms total_ms tls_authorized`,
  REAL: 'process_timeout_s',
  BLOB: 'unparsed_stdout unparsed_stderr',
})) {
  for (const name of names.trim().split(/\s+/)) columns[name] = type;
}
export const emptyRow = () => Object.fromEntries(Object.keys(columns).map((key) => [key, null]));
