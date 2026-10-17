#!/bin/zsh
set -eu
TASK_ROOT="${0:A:h:h}"
TASK_DEVELOPER_ROOT="${DEVELOPER_DIR:-$(xcode-select -p)}"
TASK_FRAMEWORK_ARGS=()
if [[ -d "$TASK_DEVELOPER_ROOT/Platforms/MacOSX.platform/Developer/Library/Frameworks/Testing.framework" ]]; then
    TASK_TESTING_ROOT="$TASK_DEVELOPER_ROOT/Platforms/MacOSX.platform/Developer"
elif [[ -d "$TASK_DEVELOPER_ROOT/Library/Developer/Frameworks/Testing.framework" ]]; then
    TASK_TESTING_ROOT="$TASK_DEVELOPER_ROOT/Library/Developer"
fi
if [[ -n "${TASK_TESTING_ROOT:-}" ]]; then
    TASK_FRAMEWORK_ARGS=(-Xswiftc -F -Xswiftc "$TASK_TESTING_ROOT/Library/Frameworks" -Xlinker -rpath -Xlinker "$TASK_TESTING_ROOT/Library/Frameworks" -Xlinker -rpath -Xlinker "$TASK_TESTING_ROOT/usr/lib")
    # CLT uses Library/Developer/Frameworks rather than Library/Frameworks.
    if [[ -d "$TASK_TESTING_ROOT/Frameworks/Testing.framework" ]]; then
        TASK_FRAMEWORK_ARGS=(-Xswiftc -F -Xswiftc "$TASK_TESTING_ROOT/Frameworks" -Xlinker -rpath -Xlinker "$TASK_TESTING_ROOT/Frameworks" -Xlinker -rpath -Xlinker "$TASK_TESTING_ROOT/usr/lib")
    fi
fi
export CLANG_MODULE_CACHE_PATH=/tmp/univ-clang-cache
export SWIFTPM_MODULECACHE_OVERRIDE=/tmp/univ-swift-cache
swift test --package-path "$TASK_ROOT/CampusCore" --scratch-path /tmp/univ-swift-build --cache-path /tmp/univ-package-cache --config-path /tmp/univ-package-config --security-path /tmp/univ-package-security --disable-sandbox --disable-xctest --enable-swift-testing "${TASK_FRAMEWORK_ARGS[@]}"
