# Demo consumer pin used for the HOT breaking-impact live demo.
# Bumps demo-v1 -> demo-v2 against the subscribed upstream module source.

module "hot_demo" {
  source = "git::https://github.com/Dhamotharanjan/tfEngineering.git//modules/hot-demo?ref=demo-v2"

  required_a = "keep-me"
  old_param  = "still-set-but-removed-upstream"
  # new_required intentionally omitted -> BREAKING
}
