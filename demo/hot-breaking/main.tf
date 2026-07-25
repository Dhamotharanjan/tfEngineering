# Demo consumer pin baseline for HOT breaking-impact POC.

module "hot_demo" {
  source = "git::https://github.com/Dhamotharanjan/demo-hot-upstream.git//stack?ref=demo-v1"

  required_a = "keep-me"
  old_param  = "still-set"
}
