#!/usr/bin/env bash
# Backups in S3-compatible storage (Cloudflare R2, Backblaze B2, AWS S3 …), kept for 30 days.
#
#   scripts/backup/storage.sh upload <file>   store a backup, named by the time now
#   scripts/backup/storage.sh latest <file>   download the newest backup to <file>
#   scripts/backup/storage.sh prune           delete backups older than RETENTION_DAYS (30)
#
# Env: BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT (the provider's S3 API address), AWS_ACCESS_KEY_ID,
# AWS_SECRET_ACCESS_KEY, and optionally BACKUP_S3_PREFIX (default "fairshare/") and
# AWS_DEFAULT_REGION (R2 uses "auto"). Uses the aws CLI, or its Docker image if it isn't installed.
set -euo pipefail

: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is not set}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is not set}"
PREFIX=${BACKUP_S3_PREFIX:-fairshare/}
RETENTION_DAYS=${RETENTION_DAYS:-30}
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-auto}
# Checksums only where S3 requires them: newer aws CLIs add them to every request by default,
# which some S3-compatible providers reject.
export AWS_REQUEST_CHECKSUM_CALCULATION=${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}
export AWS_RESPONSE_CHECKSUM_VALIDATION=${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}

aws_cli() {
  if command -v aws >/dev/null; then
    aws --endpoint-url "$BACKUP_S3_ENDPOINT" "$@"
  else
    docker run --rm --network host -v "$PWD:/work" -w /work \
      -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
      -e AWS_REQUEST_CHECKSUM_CALCULATION -e AWS_RESPONSE_CHECKSUM_VALIDATION \
      amazon/aws-cli:2.27.50 --endpoint-url "$BACKUP_S3_ENDPOINT" "$@"
  fi
}

# Keys sort by time: fairshare/2026-11-13T213000Z.dump.gpg
keys() {
  aws_cli s3api list-objects-v2 --bucket "$BACKUP_S3_BUCKET" --prefix "$PREFIX" \
    --query 'Contents[].Key' --output text | tr '\t' '\n' | grep -E '\.dump\.gpg$' | sort || true
}

case ${1:-} in
  upload)
    file=${2:?usage: storage.sh upload <file>}
    key="$PREFIX$(date -u +%Y-%m-%dT%H%M%SZ).dump.gpg"
    aws_cli s3 cp "$file" "s3://$BACKUP_S3_BUCKET/$key" --only-show-errors
    echo "Uploaded $key"
    ;;
  latest)
    dest=${2:?usage: storage.sh latest <file>}
    key=$(keys | tail -n 1)
    if [ -z "$key" ]; then
      echo "::error::No backups in s3://$BACKUP_S3_BUCKET/$PREFIX" >&2
      exit 1
    fi
    aws_cli s3 cp "s3://$BACKUP_S3_BUCKET/$key" "$dest" --only-show-errors
    echo "Downloaded $key"
    ;;
  prune)
    cutoff="$PREFIX$(date -u -d "$RETENTION_DAYS days ago" +%Y-%m-%dT%H%M%SZ)"
    count=0
    while read -r key; do
      [ -n "$key" ] || continue
      if [[ "$key" < "$cutoff" ]]; then
        aws_cli s3 rm "s3://$BACKUP_S3_BUCKET/$key" --only-show-errors
        count=$((count + 1))
      fi
    done < <(keys)
    echo "Pruned $count backup(s) older than $RETENTION_DAYS days."
    ;;
  *)
    echo "usage: storage.sh upload <file> | latest <file> | prune" >&2
    exit 64
    ;;
esac
