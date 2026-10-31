#!/usr/bin/env bash
# oracle-retry.sh: gets the free Ampere server when Mumbai says "Out of capacity".
# Run on the Mac (after `oci` is set up, see README.md):
#
#   cd ~/Documents/pakchat/deploy && caffeinate -i ./oracle-retry.sh
#
# It makes the network the first time (a public subnet, with PakChat's ports
# open), then asks Oracle for the server once a minute until it gets one. It
# only ever asks for the Always Free shape, and never makes a second server.
# Ctrl+C stops it; running it again carries on where it was.
set -uo pipefail

OCPUS=${OCPUS:-2}
MEMORY=${MEMORY:-12}
WAIT=${WAIT:-60}
NAME=pakchat
SHAPE=VM.Standard.A1.Flex
KEY=${KEY:-$HOME/.ssh/id_ed25519.pub}

say_and_show() {
  echo "$1"
  osascript -e "display notification \"$1\" with title \"PakChat server\"" 2>/dev/null || true
  [ "${SPEAK:-0}" = 1 ] && say "$1" 2>/dev/null || true
}

command -v oci >/dev/null || { echo "The oci tool isn't installed yet: brew install oci-cli"; exit 1; }
[ -f "$KEY" ] || { echo "No SSH key at $KEY. Make one: ssh-keygen -t ed25519 -N \"\" -f ~/.ssh/id_ed25519"; exit 1; }

# The account's main compartment (root) is the tenancy, from ~/.oci/config.
TENANCY=$(awk -F= '/^tenancy/ {gsub(/ /, "", $2); print $2; exit}' ~/.oci/config 2>/dev/null)
[ -n "$TENANCY" ] || { echo "No ~/.oci/config yet: make the API key first (README.md)"; exit 1; }
oci iam region list >/dev/null 2>&1 || { echo "oci can't sign in: check ~/.oci/config and the key file"; exit 1; }

echo "1/4 Is there a PakChat server already?"
EXISTING=$(oci compute instance list -c "$TENANCY" --display-name "$NAME" --all \
  --query "data[?\"lifecycle-state\"!='TERMINATED' && \"lifecycle-state\"!='TERMINATING'] | [0].id" --raw-output 2>/dev/null)
if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
  IP=$(oci compute instance list-vnics --instance-id "$EXISTING" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
  echo "There is one already (public IP: ${IP:-none yet}). Nothing to do."
  exit 0
fi

echo "2/4 The network"
VCN=$(oci network vcn list -c "$TENANCY" --display-name pakchat-vcn --lifecycle-state AVAILABLE --query 'data[0].id' --raw-output 2>/dev/null)
if [ -z "$VCN" ] || [ "$VCN" = "null" ]; then
  echo "    making it (once)"
  VCN=$(oci network vcn create -c "$TENANCY" --cidr-blocks '["10.0.0.0/16"]' --display-name pakchat-vcn \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output) || exit 1
  IGW=$(oci network internet-gateway create -c "$TENANCY" --vcn-id "$VCN" --is-enabled true --display-name pakchat-internet \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output) || exit 1
  RT=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output) || exit 1
  oci network route-table update --rt-id "$RT" --force \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null || exit 1
  # Open: SSH, the website (80, 443 and 443/UDP), and calls (3478, 49160-49200).
  SL=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output) || exit 1
  tcp() { printf '{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":%s,"max":%s}}}' "$1" "$2"; }
  udp() { printf '{"source":"0.0.0.0/0","protocol":"17","udpOptions":{"destinationPortRange":{"min":%s,"max":%s}}}' "$1" "$2"; }
  RULES="[$(tcp 22 22),$(tcp 80 80),$(tcp 443 443),$(udp 443 443),$(tcp 3478 3478),$(udp 3478 3478),$(udp 49160 49200),"
  RULES+='{"source":"0.0.0.0/0","protocol":"1","icmpOptions":{"type":3,"code":4}},{"source":"10.0.0.0/16","protocol":"1","icmpOptions":{"type":3}}]'
  oci network security-list update --security-list-id "$SL" --force --ingress-security-rules "$RULES" >/dev/null || exit 1
fi
SUBNET=$(oci network subnet list -c "$TENANCY" --vcn-id "$VCN" --display-name pakchat-subnet --lifecycle-state AVAILABLE --query 'data[0].id' --raw-output 2>/dev/null)
if [ -z "$SUBNET" ] || [ "$SUBNET" = "null" ]; then
  SUBNET=$(oci network subnet create -c "$TENANCY" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 --display-name pakchat-subnet \
    --prohibit-public-ip-on-vnic false --wait-for-state AVAILABLE --query 'data.id' --raw-output) || exit 1
fi

echo "3/4 Ubuntu 24.04 for Ampere"
AD=$(oci iam availability-domain list -c "$TENANCY" --query 'data[0].name' --raw-output) || exit 1
IMAGE=$(oci compute image list -c "$TENANCY" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --all \
  --query "data[?!contains(\"display-name\", 'Minimal')] | [0].id" --raw-output) || exit 1
[ -n "$IMAGE" ] && [ "$IMAGE" != "null" ] || { echo "Couldn't find the Ubuntu 24.04 image"; exit 1; }

echo "4/4 Asking for the server ($OCPUS OCPUs, $MEMORY GB) every $WAIT seconds. Ctrl+C stops."
tries=0
while :; do
  tries=$((tries + 1))
  # A try that timed out may still have made it: never ask for a second one.
  MADE=$(oci compute instance list -c "$TENANCY" --display-name "$NAME" --all \
    --query "data[?\"lifecycle-state\"!='TERMINATED' && \"lifecycle-state\"!='TERMINATING'] | [0].id" --raw-output 2>/dev/null)
  if [ -n "$MADE" ] && [ "$MADE" != "null" ]; then
    say_and_show "The PakChat server is made. Its public IP is on the Oracle page, or run this script again."
    exit 0
  fi
  OUT=$(oci compute instance launch -c "$TENANCY" --availability-domain "$AD" --display-name "$NAME" \
    --shape "$SHAPE" --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY}" \
    --image-id "$IMAGE" --subnet-id "$SUBNET" --assign-public-ip true --boot-volume-size-in-gbs 50 \
    --ssh-authorized-keys-file "$KEY" --wait-for-state RUNNING --query 'data.id' --raw-output 2>&1)
  if [ $? -eq 0 ]; then
    ID=$(echo "$OUT" | grep -o 'ocid1\.instance[^"[:space:]]*' | tail -1)
    IP=$(oci compute instance list-vnics --instance-id "$ID" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
    echo
    say_and_show "Got the PakChat server. Public IP: ${IP:-see the Oracle page}"
    echo "Next: ssh ubuntu@$IP   (then follow README.md from \"On the server\")"
    exit 0
  fi
  case "$OUT" in
    *"Out of host capacity"*|*"OutOfCapacity"*|*"out of capacity"*)
      printf '%s  try %d: out of capacity, again in %ss\n' "$(date +%H:%M)" "$tries" "$WAIT" ;;
    *"TooManyRequests"*|*'"status": 429'*)
      printf '%s  try %d: Oracle says too many tries, waiting 5 minutes\n' "$(date +%H:%M)" "$tries"
      sleep 240 ;;
    *"LimitExceeded"*)
      echo "$OUT"
      say_and_show "Oracle says the free limit is used. Check for another server on the Oracle page."
      exit 1 ;;
    *)
      # Probably the network or a hiccup: show it, and keep trying.
      printf '%s  try %d: %s %s\n' "$(date +%H:%M)" "$tries" "$(echo "$OUT" | grep -m1 '"code"' | sed 's/^ *//')" "$(echo "$OUT" | grep -m1 -E '"message"|Error' | sed 's/^ *//')" ;;
  esac
  sleep "$WAIT"
done
