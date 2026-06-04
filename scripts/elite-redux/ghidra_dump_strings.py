# Ghidra post-analysis script — dump strings and ARM/Thumb code sections.
# Runs inside Ghidra's Jython interpreter (Python 2.7 syntax).
# Invoked by analyzeHeadless via -postScript.
#
# Output: vendor/elite-redux/rom-extracted/ghidra-strings.txt
#         vendor/elite-redux/rom-extracted/ghidra-functions.txt

import os

OUT_DIR = "C:/Users/Hafida/pokerogue/.worktrees/elite-redux/vendor/elite-redux/rom-extracted"
if not os.path.exists(OUT_DIR):
    os.makedirs(OUT_DIR)

# Dump all defined strings.
strings_path = os.path.join(OUT_DIR, "ghidra-strings.txt")
listing = currentProgram.getListing()
mem = currentProgram.getMemory()
print "Writing strings to %s" % strings_path
with open(strings_path, "w") as f:
    data_it = listing.getDefinedData(True)
    n = 0
    while data_it.hasNext():
        d = data_it.next()
        if d.hasStringValue():
            val = d.getDefaultValueRepresentation()
            f.write("%s: %s\n" % (d.getAddress(), val.replace("\n", "\\n")))
            n += 1
    print "Wrote %d strings" % n

# Dump all named functions.
functions_path = os.path.join(OUT_DIR, "ghidra-functions.txt")
print "Writing functions to %s" % functions_path
with open(functions_path, "w") as f:
    fns = currentProgram.getFunctionManager().getFunctions(True)
    n = 0
    for fn in fns:
        if not fn.getName().startswith("FUN_"):
            f.write("%s\t%s\t%s\n" % (fn.getEntryPoint(), fn.getBody().getNumAddresses(), fn.getName()))
            n += 1
    print "Wrote %d named functions" % n

print "Ghidra dump complete."
