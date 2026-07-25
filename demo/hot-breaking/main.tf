# Demo consumer pin for HOT breaking-impact POC (cloud).
# Bumps demo-hot-upstream demo-v1 -> demo-v2 (removes old_param, adds mandatory new_required).

module "hot_demo" {
  source = "git::https://github.com/Dhamotharanjan/demo-hot-upstream.git//stack?ref=demo-v2"

  required_a = "keep-me"
  old_param  = "still-set"
  # new_required intentionally omitted -> BREAKING
}
