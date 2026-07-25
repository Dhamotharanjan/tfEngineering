# Minimal upstream module surface for the HOT breaking demo.
# demo-v1 variables: old_param, required_a
# demo-v2 variables: required_a, new_required (old_param removed)

variable "required_a" {
  type = string
}

variable "new_required" {
  type = string
}

output "id" {
  value = "hot-demo"
}
