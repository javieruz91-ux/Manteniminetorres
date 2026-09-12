const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

code = code.replace("name: 'Alarmas de fuerza'", "name: 'ALARMAS DE FUERZA'");
code = code.replace("name: 'Planta Huawei'", "name: 'PLANTA HUAWEI'");
code = code.replace("name: 'Infraestructura'", "name: 'INFRAESTRUCTURA'");
code = code.replace("name: 'Electromecánica'", "name: 'ELECTROMECANICA'");
code = code.replace("name: 'Tierras'", "name: 'TIERRAS'");
code = code.replace("name: 'Transmisión'", "name: 'TRANSMISION'");

fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
