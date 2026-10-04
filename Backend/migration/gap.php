<?php
// Exact row count for every table in the legacy DB. Counts only, no data.
$env=[];
foreach(file(getcwd().'/.env',FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $l){
  if($l===''||$l[0]==='#'||!str_contains($l,'='))continue;
  [$k,$v]=explode('=',$l,2); $env[trim($k)]=trim(trim($v),"\"'");
}
$pdo=new PDO("mysql:host={$env['DB_HOST']};dbname={$env['DB_DATABASE']};charset=utf8mb4",
  $env['DB_USERNAME'],$env['DB_PASSWORD'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$tables=$pdo->query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY table_name")
  ->fetchAll(PDO::FETCH_COLUMN);
$out=[];
foreach($tables as $t){ $out[$t]=(int)$pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn(); }
file_put_contents(__DIR__.'/_counts.json',json_encode($out));
$n=count(array_filter($out));
echo "counted ".count($out)." tables, $n non-empty\n";
