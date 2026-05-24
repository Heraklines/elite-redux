# Ghidra pre-script: set TMode=1 (Thumb mode) on the entire GBA ROM code
# range BEFORE auto-analysis runs. This dramatically reduces "Unable to
# resolve constructor" warnings caused by the analyzer picking the wrong
# instruction set at every function entry.
#
# GBA Emerald (and Elite Redux) is overwhelmingly Thumb code. The few ARM
# functions are entered via BX with bit 0 = 0; Ghidra's auto-analyzer
# detects those switches correctly once Thumb is the default.
#
# Run via: -preScript ghidra-set-thumb-mode.py
#
# Reference: https://github.com/pret/pokeemerald/wiki/Disassembling
# @category ER

from ghidra.program.model.address import AddressSet
from ghidra.program.model.lang import RegisterValue
from java.math import BigInteger

ROM_START = 0x08000000
ROM_END = 0x09FFFFFF  # 32MB ROM mapped at 0x08000000

program = currentProgram
mem = program.getMemory()
ctx = program.getProgramContext()
tmode = ctx.getRegister("TMode")

if tmode is None:
    print("[set-thumb-mode] No TMode register found; aborting.")
else:
    addr_factory = program.getAddressFactory()
    start = addr_factory.getAddress(hex(ROM_START)[2:])
    # Use the actual loaded end (not the full 32MB upper bound)
    rom_block = None
    for block in mem.getBlocks():
        if block.getStart().getOffset() == ROM_START:
            rom_block = block
            break
    if rom_block is None:
        print("[set-thumb-mode] No ROM block at 0x08000000; aborting.")
    else:
        end = rom_block.getEnd()
        print("[set-thumb-mode] Setting TMode=1 on %s - %s" % (start, end))
        ctx.setValue(tmode, start, end, BigInteger.ONE)
        print("[set-thumb-mode] Done.")
