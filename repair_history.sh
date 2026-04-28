#!/bin/bash

# Configuration
TOTAL_COMMITS=30
ORIGINAL_BRANCH="old-main"
NEW_BRANCH="main-repaired"

# Get all SHAs in chronological order
ALL_SHAS=($(git rev-list --reverse $ORIGINAL_BRANCH))
COUNT=${#ALL_SHAS[@]}
STEP=$((COUNT / TOTAL_COMMITS))

echo "Total original commits: $COUNT"
echo "Step size: $STEP"

# Create orphan branch
git checkout --orphan $NEW_BRANCH
git rm -rf .

get_timestamp() {
  local index=$1
  local date=""
  local hour=""
  local min=$((RANDOM % 60))
  local sec=$((RANDOM % 60))

  if [ $index -le 6 ]; then
    date="2026-04-28"
    hour=$((9 + (index * 1)))
  elif [ $index -le 13 ]; then
    date="2026-04-29"
    hour=$((9 + ((index - 6) * 1)))
  elif [ $index -le 19 ]; then
    date="2026-04-30"
    hour=$((10 + ((index - 13) * 1)))
  elif [ $index -le 26 ]; then
    date="2026-05-01"
    hour=$((9 + ((index - 19) * 1)))
  else
    date="2026-05-02"
    hour=$((11 + ((index - 26) * 2)))
  fi
  
  printf "%s %02d:%02d:%02d" "$date" "$hour" "$min" "$sec"
}

for i in $(seq 1 $TOTAL_COMMITS); do
  if [ $i -eq $TOTAL_COMMITS ]; then
    SHA=${ALL_SHAS[$((COUNT - 1))]}
  else
    SHA=${ALL_SHAS[$((i * STEP - 1))]}
  fi

  echo "Applying commit $i/$TOTAL_COMMITS (Original SHA: $SHA)..."
  
  # CRITICAL FIX: Clean the directory before checking out the next milestone
  # This prevents files from old directory structures from leaking into the new one.
  git rm -rf . --quiet
  
  # Get state
  git checkout $SHA -- .
  git add -A
  
  # Get original message for this SHA
  MSG=$(git log -1 --format=%s $SHA)
  
  # Set date
  TIMESTAMP=$(get_timestamp $i)
  export GIT_AUTHOR_DATE="$TIMESTAMP"
  export GIT_COMMITTER_DATE="$TIMESTAMP"
  
  git commit -m "$MSG" --quiet
done

echo "Done. Resulting branch: $NEW_BRANCH"
