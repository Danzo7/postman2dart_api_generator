// ESM syntax is supported.
import fetch, { Headers } from "node-fetch";
import * as fs from "fs";
import * as path from "path";
import * as cap from "@shipengine/capitalization";
import { readFile } from "fs/promises";

const dir = path.join(path.resolve(), "api");
let classes = [];
const functionNames = [];
const classesNames = [];
let totalClasses = 0;
const obj = JSON.parse(await readFile(new URL("test.json", import.meta.url)));

const generateApi = async (obj) => {
  InitDartFile();
  let counter = 1;
  //const items = obj.item.slice(0, 8);
  for (const { request, name } of obj.item) {
    console.log(`${counter}/${obj.item.length}`);
    writeToDart(`${await requestToFunction(request, name)}
    `);
    counter++;
    console.log("take break for 250ms...");
    await new Promise((resolve) => setTimeout(resolve, 250)); // 3 sec
  }
  closeClass();
  writeClasses(classes);
  console.log(
    ` generate  ${functionNames.length}  / ${obj.item.length} Api Function. 
      ${obj.item.length - functionNames.length} are duplicated.`
  );
  console.log(
    ` generate  ${classesNames.length}  / ${totalClasses} Api Function. 
       ${totalClasses - classesNames.length} are duplicated.`
  );
};
const typeof1 = (x) => {
  switch (typeof x) {
    case "string":
      return "String?";
    case "number":
      return "int?";
    case "boolean":
      return "bool?";
    case "object":
      return Array.isArray(x) ? "list" : x == null ? "dynamic" : "object";
    default:
      return "dynamic";
  }
};
const jsonToDart = (cName, object, isList = false) => {
  totalClasses++;
  if (classesNames.includes(cName)) return "";
  classesNames.push(cName);
  let headers = "";
  let cBody = "";
  let fJson = "";
  let tJson = "";
  for (const [key, value] of Object.entries(isList ? object[0] : object)) {
    let type = processTyping(key, value);
    headers += `${type} ${cap.camelCase(key)};
    `;
    cBody += ` this.${cap.camelCase(key)}, `;
    fJson += `///known value \`${provideKnown(value, key)}\`
    ${cap.camelCase(key)} = json['${key}'];
    `;
    tJson += `data['${key}'] = ${cap.camelCase(key)};
    `;
  }

  classes.push(`class ${cName} {
    ${headers}
  
    ${cName}({${cBody.slice(0, -1)}});
  
    ${cName}.fromJson(Map<String, dynamic> json) {
      ${fJson}
    }
  
    Map<String, dynamic> toJson() {
      final Map<String, dynamic> data = new Map<String, dynamic>();
      ${tJson}
      return data;
    }
  }`);
};

const requestToFunction = async (currentRequest, desc = "") => {
  if (functionNames.includes(cap.camelCase(currentRequest.url.path[1])))
    return "";

  functionNames.push(cap.camelCase(currentRequest.url.path[1]));

  const params = Object.values(JSON.parse(currentRequest.body.raw))[0];
  const entryPoint = Object.keys(JSON.parse(currentRequest.body.raw))[0];
  const entries = Object.entries(params);
  let fParams = ``;
  let fBody = ``;
  for (const [key, value] of entries) {
    let type = processTyping(key, value);
    fParams += `${type} ${cap.camelCase(key)},`;
    fBody += ` "${key}": ${cap.camelCase(key)},//known value \`${provideKnown(
      value,
      key
    )}\`
`;
  }

  const res = await requestSender(currentRequest);
  const [key, value] = Object.entries(res)[0];
  let type = processTyping(key, value);
  return (
    `/// #### ${desc} .
  static Future<${type}> ${cap.camelCase(currentRequest.url.path[1])}(
    {${fParams.slice(0, -1)}}) async {
        var headers = {'Content-Type': 'application/json'};
        var request = http.Request(
              '${currentRequest?.method ?? "POST"}',
              Uri.parse('${currentRequest.url.raw}'));
          request.body = json.encode({
            "${entryPoint}": {
      ${fBody.slice(0, -1)}
    }
  });
  request.headers.addAll(headers);

  http.StreamedResponse response = await request.send();

  if (response.statusCode == 200) {
    //Last return =>${provideKnown(value, key)}
    String str = await response.stream.bytesToString();
    ${
      type.includes("List") ? "List<dynamic>?" : "dynamic"
    } targetObj = jsonDecode(str)${key != "default" ? '["' + key + '"]' : ""};
` +
    (typeof value == "object" && typeof1(value) != "dynamic"
      ? `
    return (${
      type.includes("List")
        ? type.includes("dynamic")
          ? "targetObj"
          : "targetObj?.map((e) => " +
            cap.pascalCase(key) +
            ".fromJson(e)).toList()"
        : cap.pascalCase(key) + ".fromJson(targetObj)"
    });`
      : "return targetObj;") +
    `
  } else {
    print(jsonDecode(response.reasonPhrase ?? ""));
    return null;
  }
}
`
  );
};

const requestSender = async (currentRequest) => {
  const myHeaders = new Headers();
  myHeaders.append(
    "Content-Type",
    "application/json",
    "Accept",
    "application/json"
  );
  let raw = currentRequest.body.raw;
  let requestOptions = {
    method: currentRequest?.method ?? "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow",
  };
  console.log("Sending request...");

  let res = await fetch(currentRequest.url.raw, requestOptions);

  if (res.headers.get("content-type").includes("html"))
    return { default: null };
  if (res.headers.get("content-type").includes("plain")) {
    return { default: await res.text() };
  }
  if (res.headers.get("content-type").includes("json")) {
    return await res.json();
  }
};
function InitDartFile() {
  fs.mkdirSync(dir, {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(dir, "api.dart"),
    `import 'package:http/http.dart' as http;
import 'dart:convert';

    class Api{

      `,
    {
      flag: "w",
    }
  );
}
function closeClass() {
  writeToDart("}");
}
function writeClasses(classes) {
  for (const klass of classes) {
    writeToDart(`${klass}
    `);
  }
}

function writeToDart(str) {
  fs.writeFileSync(path.join(dir, "api.dart"), str, { flag: "a+" });
}
function processTyping(key, value) {
  let type = typeof1(value);
  if (type == "list") {
    if (value.length == 0) type = `List<dynamic>?`;
    else {
      type = `List<${cap.pascalCase(key)}>?`;
      jsonToDart(cap.pascalCase(key), value, true);
    }
  } else if (type === "object") {
    if (Object.keys(value).length == 0) type = `Map<String, dynamic>?`;
    else {
      type = `${cap.pascalCase(key)}?`;
      jsonToDart(cap.pascalCase(key), value, false);
    }
  }
  return type;
}

generateApi(obj);
//console.log(await requestToFunction(obj.item[65].request));
function provideKnown(value, type) {
  return typeof value == "string"
    ? value.length > 30
      ? value.substr(0, 30).padEnd(34, ".")
      : value
    : typeof value != "object"
    ? value
    : type.includes("List") || type.includes("Map")
    ? JSON.stringify(value)
    : type;
}
