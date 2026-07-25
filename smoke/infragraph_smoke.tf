# InfraGraph smoke test — harmless IaC touch for PR webhook/status verification.
variable "infragraph_smoke" {
  type        = string
  description = "Smoke variable for InfraGraph HOT impact / commit status"
  default     = "ok"
}
