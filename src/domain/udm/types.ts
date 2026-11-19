import type { UdmEventType } from "./event-types"

export type UdmJsonPrimitive = string | number | boolean | null
export type UdmJsonValue =
  | UdmJsonPrimitive
  | UdmJsonValue[]
  | { [key: string]: UdmJsonValue }

export type UdmTimestamp = string

export type UdmLabel = {
  key?: string
  value?: string
}

export type UdmPlatform = "LINUX" | "MAC" | "WINDOWS" | "UNKNOWN_PLATFORM"

export type UdmMetadata = {
  event_type: UdmEventType
  event_timestamp: UdmTimestamp
  collected_timestamp?: UdmTimestamp
  description?: string
  ingested_timestamp?: UdmTimestamp
  ingestion_labels?: UdmLabel[]
  log_type?: string
  product_deployment_id?: string
  product_event_type?: string
  product_log_id?: string
  product_name?: string
  product_version?: string
  url_back_to_product?: string
  vendor_name?: string
}

export type UdmUser = {
  email_addresses?: string[]
  first_name?: string
  group_identifiers?: string[]
  last_name?: string
  product_object_id?: string
  userid?: string
  user_display_name?: string
  windows_sid?: string
}

export type UdmProcess = {
  command_line?: string
  file?: UdmFile
  parent_process?: UdmProcess
  pid?: string | number
  product_specific_process_id?: string
}

export type UdmFile = {
  full_path?: string
  md5?: string
  mime_type?: string
  names?: string[]
  sha1?: string
  sha256?: string
  size?: string | number
}

export type UdmRegistry = {
  registry_key?: string
  registry_value_data?: string
  registry_value_name?: string
  registry_value_type?: string
}

export type UdmLocation = {
  city?: string
  country_or_region?: string
  desk_name?: string
  floor_name?: string
  name?: string
  region_coordinates?: {
    latitude?: number
    longitude?: number
  }
  region_latitude?: number
  region_longitude?: number
  state?: string
}

export type UdmArtifact = {
  as_owner?: string
  asn?: string | number
  first_seen_time?: UdmTimestamp
  last_seen_time?: UdmTimestamp
  location?: UdmLocation
  network?: UdmNetwork
}

export type UdmNoun = {
  administrative_domain?: string
  asset_id?: string
  email?: string
  file?: UdmFile
  hostname?: string
  ip?: string[]
  ip_geo_artifact?: UdmArtifact[]
  ip_location?: UdmLocation[]
  location?: UdmLocation
  mac?: string[]
  namespace?: string
  platform?: UdmPlatform
  platform_patch_level?: string
  platform_version?: string
  port?: number
  process?: UdmProcess
  registry?: UdmRegistry
  resource?: UdmResource
  url?: string
  user?: UdmUser
}

export type UdmResource = {
  attribute?: {
    labels?: UdmLabel[]
  }
  name?: string
  product_object_id?: string
  resource_subtype?: string
  resource_type?: string
}

export type UdmNetwork = {
  application_protocol?: string
  application_protocol_version?: string
  asn?: string
  carrier_name?: string
  community_id?: string
  direction?: string
  dns?: UdmDns
  dns_domain?: string
  email?: UdmEmail
  ftp?: UdmFtp
  http?: UdmHttp
  ip_protocol?: string
  ip_subnet_range?: string
  organization_name?: string
  parent_session_id?: string
  received_bytes?: string | number
  received_packets?: string | number
  sent_bytes?: string | number
  sent_packets?: string | number
  session_duration?: {
    nanos?: number
    seconds?: string | number
  }
  session_id?: string
}

export type UdmFtp = {
  command?: string
}

export type UdmDns = {
  answers?: UdmDnsResourceRecord[]
  authoritative?: boolean
  id?: number
  questions?: UdmDnsQuestion[]
  response?: boolean
  response_code?: number | string
}

export type UdmDnsQuestion = {
  class?: string | number
  name?: string
  type?: string | number
}

export type UdmDnsResourceRecord = UdmDnsQuestion & {
  data?: string
  ttl?: number
}

export type UdmEmail = {
  bcc?: string[]
  bounce_address?: string
  cc?: string[]
  from?: string
  mail_id?: string
  reply_to?: string
  subject?: string[]
  to?: string[]
}

export type UdmHttp = {
  method?: string
  parsed_user_agent?: string
  referral_url?: string
  response_code?: number
  user_agent?: string
}

export type UdmSecurityResult = {
  action?: string[]
  action_details?: string
  alert_state?: string
  confidence?: string
  confidence_score?: number
  description?: string
  detection_fields?: UdmLabel[]
  priority?: string
  risk_score?: number
  rule_author?: string
  rule_id?: string
  rule_labels?: UdmLabel[]
  rule_name?: string
  rule_type?: string
  rule_version?: string
  severity?: string
  summary?: string
}

export type UdmExtensions = {
  auth?: UdmJsonValue
  entity_risk?: UdmJsonValue
  linux_utmp?: UdmJsonValue
  outlook_metadata?: UdmJsonValue
  resource_usage?: UdmJsonValue
  system_event_details?: UdmJsonValue
  vulns?: UdmJsonValue
  windows_event_log?: UdmJsonValue
}

export type UdmEvent = {
  metadata: UdmMetadata
  about?: UdmNoun[]
  additional?: Record<string, UdmJsonValue>
  extensions?: UdmExtensions
  extracted?: Record<string, UdmJsonValue>
  grouped?: Record<string, UdmJsonValue>
  intermediary?: UdmNoun[]
  network?: UdmNetwork
  observer?: UdmNoun
  principal?: UdmNoun
  security_result?: UdmSecurityResult[]
  src?: UdmNoun
  target?: UdmNoun
}

export const UDM_TOP_LEVEL_FIELDS = [
  "metadata",
  "additional",
  "principal",
  "src",
  "target",
  "intermediary",
  "observer",
  "about",
  "security_result",
  "network",
  "extensions",
  "extracted",
  "grouped",
] as const

export type UdmTopLevelField = (typeof UDM_TOP_LEVEL_FIELDS)[number]
