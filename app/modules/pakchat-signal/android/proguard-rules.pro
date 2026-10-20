# Keep all of Signal's library when the release build shrinks the app.
# Its Rust core calls back into Java code (like the key stores) through JNI,
# and the shrinker can't see those calls, so it would delete that code.
-keep class org.signal.libsignal.** { *; }
-keep interface org.signal.libsignal.** { *; }
