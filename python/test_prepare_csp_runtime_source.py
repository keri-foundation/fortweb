import io
import json
import subprocess
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import prepare_csp_runtime_source as producer


class PrepareCspRuntimeSourceTest(unittest.TestCase):
    def test_pyscript_patch_is_exact_and_rejects_changed_input(self):
        source = (
            b"return Function(`return(w,x)=>(${r})(w,x,...[${s}])`)();"
            + br"Dt=e=>Function(`\'use strict\';return (${e})`)()"
        )
        with patch.object(producer, "PYSCRIPT_SHA256", producer.digest(source)):
            transformed = producer.patch_pyscript(source)
            self.assertIn(b"Unsupported PyScript worker hook", transformed)
            self.assertNotIn(b"return Function(`return(w,x)", transformed)
            with self.assertRaises(ValueError):
                producer.patch_pyscript(source + b" ")

    def test_static_callbacks_execute_and_unknown_callback_fails_closed(self):
        bodies = ["{ return Module.getRandomValue(); }", "{ Module.getRandomValue = () => 42; }"]
        source = b"function register(start,body){let func='unused';ASM_CONSTS[start]=eval(func)}"
        hashes = tuple(producer.digest(body.encode()) for body in bodies)
        with patch.object(producer, "PYODIDE_SHA256", producer.digest(source)), patch.object(
            producer, "ASM_SHA256", hashes
        ):
            transformed = producer.patch_pyodide(source, bodies).decode()
            with self.assertRaises(ValueError):
                producer.patch_pyodide(source, [bodies[0], bodies[1] + " "])
        script = (
            "const ASM_CONSTS={},Module={};" + transformed
            + "register(0," + json.dumps(bodies[1]) + ");ASM_CONSTS[0]();"
            + "register(1," + json.dumps(bodies[0]) + ");"
            + "if(ASM_CONSTS[1]()!==42)throw Error('wrong callback');"
            + "let rejected=false;try{register(2,'{ unknown(); }')}catch(e){rejected=true}"
            + "if(!rejected)throw Error('unknown callback accepted');"
        )
        subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)

    def test_extraction_rejects_unpinned_wheel(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr("pysodium/libsodium.so", b"not the pinned module")
        with self.assertRaisesRegex(ValueError, "unexpected pysodium"):
            producer.extract_sodium_callbacks(output.getvalue())

    def test_bundled_hook_accepts_only_the_pinned_default(self):
        bundle = (Path(__file__).resolve().parents[1] / "vendor/pyscript/2025.11.2/core-DSF9czGY.js").read_text()
        start = bundle.index("Oo=(e,t)=>")
        end = bundle.index(",Lo=ko(", start)
        sender = bundle[start:end].replace("Oo=", "const Oo=", 1)
        start = bundle.index("Dt=e=>{if(e!==")
        end = bundle.index(",Lt=e=>", start)
        revival = json.loads('"' + bundle[start:end] + '"').replace("Dt=", "const Dt=", 1)
        script = (
            "const hook=" + producer.DEFAULT_HOOK + ";let entries=[hook];"
            + "const Po=()=>entries,Co=x=>String(x);" + sender + ";" + revival + ";"
            + "if(Oo({},'onBeforeRunAsync')!==hook)throw Error('default hook changed');"
            + "let rejected=false;try{Oo({},'onReady')}catch(e){rejected=true}"
            + "if(!rejected)throw Error('unknown hook accepted');"
            + "rejected=false;try{Oo({_onBeforeRunAsync:()=>1},'onBeforeRunAsync')}catch(e){rejected=true}"
            + "if(!rejected)throw Error('custom hook accepted');"
            + "entries=[()=>1];rejected=false;try{Oo({},'onBeforeRunAsync')}catch(e){rejected=true}"
            + "if(!rejected)throw Error('unexpected callback accepted');"
            + "let module;const restored=Dt(" + json.dumps(producer.DEFAULT_HOOK) + ");"
            + "restored({interpreter:{registerJsModule:(name,value)=>{module={name,value}}}});"
            + "if(module.name!=='_pyscript'||module.value.fs.NAMESPACE!=='@pyscript.fs')throw Error('hook changed');"
            + "rejected=false;try{Dt('unexpected')}catch(e){rejected=true}"
            + "if(!rejected)throw Error('unexpected worker hook accepted');"
        )
        subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)


if __name__ == "__main__":
    unittest.main()
