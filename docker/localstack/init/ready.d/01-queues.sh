#!/bin/sh
set -e

QUEUE=wager-transactions.fifo
DLQ=wager-transactions-dlq.fifo

awslocal sqs create-queue --queue-name "$DLQ" --attributes FifoQueue=true

DLQ_URL=$(awslocal sqs get-queue-url --queue-name "$DLQ" --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

cat > /tmp/queue-attributes.json <<EOF
{
  "FifoQueue": "true",
  "VisibilityTimeout": "30",
  "MessageRetentionPeriod": "1209600",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"
}
EOF

awslocal sqs create-queue --queue-name "$QUEUE" --attributes file:///tmp/queue-attributes.json

EVENTS_DLQ=wager-events-dlq.fifo
EVENTS=wager-events.fifo

awslocal sqs create-queue --queue-name "$EVENTS_DLQ" --attributes FifoQueue=true

EVENTS_DLQ_URL=$(awslocal sqs get-queue-url --queue-name "$EVENTS_DLQ" --output text)
EVENTS_DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$EVENTS_DLQ_URL" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

cat > /tmp/events-attributes.json <<EOF
{
  "FifoQueue": "true",
  "VisibilityTimeout": "30",
  "MessageRetentionPeriod": "1209600",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"${EVENTS_DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"
}
EOF

awslocal sqs create-queue --queue-name "$EVENTS" --attributes file:///tmp/events-attributes.json