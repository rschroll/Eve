use std::collections::HashMap;
use cpython::{PythonObject, Python, ObjectProtocol};
use value::{Value};

// Primitive views are how Eve programs access built-in functions
#[derive(Clone, Debug, Copy)]
pub struct PythonFunc {
    func_name: usize,
}

impl PythonFunc {
    pub fn new(name: usize) -> PythonFunc {
        PythonFunc {
            func_name: name,
        }
    }

    pub fn eval<'a>(&self, input_bindings: &[(usize, usize)], inputs: &[Value], source: &str, errors: &mut Vec<Vec<Value>>) -> Vec<Vec<Value>> {
        //use python::Python::*;
        use value::Value::*;
        let values = input_bindings.iter().enumerate().map(|(ix, &(field_ix, variable_ix))| {
            assert_eq!(ix, field_ix);
            &inputs[variable_ix]
        }).collect::<Vec<_>>();
        let mut type_error = || {
            errors.push(vec![
                String(source.to_owned()),
                string!("Type error while calling: {:?} {:?}", self, &values)
                ]);
            vec![]
        };
        let res = FUNCS[self.func_name].rsplitn(2, '.').collect::<Vec<&str>>();
        match &values[..] {
            // NOTE be aware that arguments will be in alphabetical order by field id
            [ref a] => {
                match a.parse_as_f64_vec() {
                    Some(a) => {
                        let gil = Python::acquire_gil();
                        let py = gil.python();
                        let pkg = py.import(res[1]).unwrap();
                        let func = pkg.get(res[0]).unwrap();

                        if a.len() == 0 {
                            vec![vec![Float(0f64)]]
                        } else {
                            let res: f64 = func.call((&a[..],), None).unwrap().extract().unwrap();
                            vec![vec![Float(res)]]
                        }
                    }
                    None => type_error(),
                }
            }
            _ => type_error(),
        }
    }

    pub fn from_str(string: &str) -> Self {
        match INDEX.get(&string) {
            Some(n) => PythonFunc::new(*n),
            None => panic!("Unknown python function: {:?}", string),
        }
    }
}

lazy_static! {
    static ref FUNCS: Vec<&'static str> = {
        let mut m = Vec::new();
        for &(name, _, _, _, _) in python_funcs().iter() {
            m.push(name);
        }
        m
    };
    static ref INDEX: HashMap<&'static str, usize> = {
        let mut m = HashMap::new();
        for (i, &(name, _, _, _, _)) in python_funcs().iter().enumerate() {
            m.insert(name, i);
        }
        m
    };
}

// List of (view_id, scalar_input_field_ids, vector_input_field_ids, output_field_ids, description)
pub fn python_funcs() -> Vec<(&'static str, Vec<&'static str>, Vec<&'static str>, Vec<&'static str>, &'static str)> {
    vec![
        ("numpy.amin", vec![], vec!["A"], vec!["result"], "Minimum value"),
        ("numpy.amax", vec![], vec!["A"], vec!["result"], "Maximum value"),
        ("numpy.median", vec![], vec!["A"], vec!["result"], "Median value"),
        ("numpy.average", vec![], vec!["A"], vec!["result"], "Average value"),
        ("numpy.mean", vec![], vec!["A"], vec!["result"], "Arithmetic mean"),
        ("numpy.std", vec![], vec!["A"], vec!["result"], "Standard deviation."),
        ("numpy.var", vec![], vec!["A"], vec!["result"], "Variance"),
    ]
}
