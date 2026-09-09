#!/bin/bash

# نسخة احتياطية
cp server.js server.js.backup

# حذف السطر المسبب للمشكلة
sed -i '/setAppCacheEnabled/d' server.js

echo "Done! Fixed."
