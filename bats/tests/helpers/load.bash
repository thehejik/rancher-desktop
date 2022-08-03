source "$(dirname "${BASH_SOURCE[0]}")/../../bats-support/load.bash"
source "$(dirname "${BASH_SOURCE[0]}")/../../bats-assert/load.bash"
# "defaults.bash" *must* be sourced before the rest of the files
source "$(dirname "${BASH_SOURCE[0]}")/defaults.bash"
source "$(dirname "${BASH_SOURCE[0]}")/os.bash"
source "$(dirname "${BASH_SOURCE[0]}")/commands.bash"
source "$(dirname "${BASH_SOURCE[0]}")/containers.bash"
source "$(dirname "${BASH_SOURCE[0]}")/kubernetes.bash"
source "$(dirname "${BASH_SOURCE[0]}")/lima.bash"
source "$(dirname "${BASH_SOURCE[0]}")/try.bash"
source "$(dirname "${BASH_SOURCE[0]}")/vm.bash"

